//! End to end through the built program, against a temporary Raw Accel folder whose writer.exe is a stand-in script that
//! records each call (Unix only: the real writer.exe is a Windows program).
#![cfg(unix)]

use serde_json::Value;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Command, Output};

const SETTINGS: &str = include_str!("fixtures/rawaccel-1.7-settings.json");
const PROFILE: &str = include_str!("fixtures/spraylab-direction-profile.json");
const DPI: &str = "Output DPI";
const UD: &str = "U/D output DPI ratio (up sens multiplier)";
const ROTATION: &str = "Degrees of rotation";

struct Setup {
    root: PathBuf,
    raw: PathBuf,
    home: PathBuf,
}

impl Setup {
    fn new(name: &str) -> Setup {
        let root = std::env::temp_dir().join(format!("spraylab-direction-cli-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let (raw, home) = (root.join("Raw Accel"), root.join("home"));
        fs::create_dir_all(&raw).unwrap();
        fs::create_dir_all(home.join("Downloads")).unwrap();
        fs::write(raw.join("settings.json"), SETTINGS).unwrap();
        // Logs the settings path it was given and exits with the code in writer-exit (0 without it).
        let writer = raw.join("writer.exe");
        fs::write(&writer, "#!/bin/sh\ndir=$(dirname \"$0\")\necho \"$1\" >> \"$dir/writer.log\"\nexit $(cat \"$dir/writer-exit\" 2>/dev/null || echo 0)\n").unwrap();
        fs::set_permissions(&writer, fs::Permissions::from_mode(0o755)).unwrap();
        fs::write(home.join("Downloads").join("spraylab-direction-profile.json"), PROFILE).unwrap();
        Setup { root, raw, home }
    }

    fn run(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_spraylab-direction-cli"))
            .args(args)
            .arg("--rawaccel")
            .arg(&self.raw)
            .env("HOME", &self.home)
            .env_remove("USERPROFILE")
            .env("APPDATA", self.home.join("AppData"))
            .output()
            .unwrap()
    }

    fn settings_text(&self) -> String {
        fs::read_to_string(self.raw.join("settings.json")).unwrap()
    }

    fn profile(&self) -> Value {
        serde_json::from_str::<Value>(&self.settings_text()).unwrap()["profiles"][0].clone()
    }

    fn writer_calls(&self) -> Vec<String> {
        fs::read_to_string(self.raw.join("writer.log")).map(|log| log.lines().map(str::to_string).collect()).unwrap_or_default()
    }
}

impl Drop for Setup {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn apply_writes_the_newest_download_and_off_puts_the_file_back_exactly() {
    let setup = Setup::new("apply");
    let applied = setup.run(&["apply"]);
    assert!(applied.status.success(), "{}{}", stdout(&applied), stderr(&applied));
    assert!(stdout(&applied).contains("The SprayLab profile is on"));
    let profile = setup.profile();
    assert_eq!(profile[DPI], 1034.1);
    assert_eq!(profile[ROTATION], 1.25);
    assert!((profile[UD].as_f64().unwrap() - 1.0836 / 1.0015).abs() < 1e-6);
    // writer.exe got settings.json; the original is kept once; the profile is installed for the window.
    assert_eq!(setup.writer_calls().len(), 1);
    assert!(setup.writer_calls()[0].ends_with("settings.json"));
    assert_eq!(fs::read_to_string(setup.raw.join("settings.json.spraylab-backup")).unwrap(), SETTINGS);
    assert!(setup.raw.join("spraylab-direction-profile.json").is_file());
    assert!(stdout(&setup.run(&["status"])).contains("SprayLab profile: ON"));

    // Applying again replaces the profile rather than stacking it on itself.
    assert!(setup.run(&["apply"]).status.success());
    assert_eq!(setup.profile()[DPI], 1034.1);
    assert_eq!(setup.writer_calls().len(), 2);

    let off = setup.run(&["off"]);
    assert!(off.status.success(), "{}", stderr(&off));
    assert_eq!(setup.settings_text(), SETTINGS);
    assert_eq!(setup.writer_calls().len(), 3);
    assert!(stdout(&setup.run(&["off"])).contains("already off"));
    assert!(stdout(&setup.run(&["status"])).contains("SprayLab profile: off"));
}

#[test]
fn a_change_made_outside_needs_rebase_and_rebase_builds_on_it() {
    let setup = Setup::new("rebase");
    assert!(setup.run(&["apply"]).status.success());
    // As if Raw Accel's window had changed Output DPI with the profile on.
    let edited = setup.settings_text().replace(r#""Output DPI": 1034.1"#, r#""Output DPI": 1100.0"#);
    fs::write(setup.raw.join("settings.json"), &edited).unwrap();
    let refused = setup.run(&["apply"]);
    assert!(!refused.status.success());
    assert!(stderr(&refused).contains("--rebase"), "{}", stderr(&refused));
    assert_eq!(setup.settings_text(), edited);
    assert!(setup.run(&["apply", "--rebase"]).status.success());
    assert!((setup.profile()[DPI].as_f64().unwrap() - 1100.0 * 1.0341).abs() < 1e-6);
}

#[test]
fn a_failing_writer_leaves_settings_as_they_were() {
    let setup = Setup::new("writer");
    fs::write(setup.raw.join("writer-exit"), "1").unwrap();
    let failed = setup.run(&["apply"]);
    assert!(!failed.status.success());
    assert!(stderr(&failed).contains("back as it was"), "{}", stderr(&failed));
    assert_eq!(setup.settings_text(), SETTINGS);
    assert!(!setup.raw.join("spraylab-direction-state.json").exists());
    assert_eq!(setup.writer_calls().len(), 1);
}

#[test]
fn dry_run_and_strength() {
    let setup = Setup::new("dry");
    let dry = setup.run(&["apply", "--dry-run"]);
    assert!(dry.status.success() && stdout(&dry).contains("Dry run"));
    assert_eq!(setup.settings_text(), SETTINGS);
    assert!(setup.writer_calls().is_empty());
    assert!(setup.run(&["apply", "--strength", "0.5"]).status.success());
    assert!((setup.profile()[DPI].as_f64().unwrap() - 1000.0 * 1.0341f64.sqrt()).abs() < 1e-6);
    assert_eq!(setup.profile()[ROTATION], 0.625);
    assert!(!setup.run(&["apply", "--strength", "2"]).status.success());
}

#[test]
fn refuses_a_file_that_is_not_a_profile() {
    let setup = Setup::new("bad");
    let bad = setup.root.join("bad.json");
    fs::write(&bad, r#"{"format": "something"}"#).unwrap();
    let refused = setup.run(&["apply", bad.to_str().unwrap()]);
    assert!(!refused.status.success() && stderr(&refused).contains("cannot be used"), "{}", stderr(&refused));
    assert_eq!(setup.settings_text(), SETTINGS);
}

#[test]
fn a_relative_raw_accel_folder_reaches_writer_as_an_absolute_settings_path() {
    // writer.exe runs inside Raw Accel's folder, so a relative settings path would point somewhere else.
    let setup = Setup::new("relative");
    let applied = Command::new(env!("CARGO_BIN_EXE_spraylab-direction-cli"))
        .args(["apply", "--rawaccel", "Raw Accel"])
        .current_dir(&setup.root)
        .env("HOME", &setup.home)
        .env_remove("USERPROFILE")
        .output()
        .unwrap();
    assert!(applied.status.success(), "{}", stderr(&applied));
    let call = &setup.writer_calls()[0];
    assert!(std::path::Path::new(call).is_absolute() && call.ends_with("Raw Accel/settings.json"), "{call}");
}

#[test]
fn run_and_startup_moved_to_the_window_and_a_raw_accel_folder_is_required() {
    let setup = Setup::new("run");
    assert!(stderr(&setup.run(&["run"])).contains("in the window now"));
    assert!(stderr(&setup.run(&["startup", "on"])).contains("in the window now"));
    let lost = Command::new(env!("CARGO_BIN_EXE_spraylab-direction-cli")).arg("status").current_dir(&setup.root).output().unwrap();
    assert!(!lost.status.success() && stderr(&lost).contains("Cannot find Raw Accel"));
}

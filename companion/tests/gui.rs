//! The window, headless: the real MainWindow and Tray, driven through their callbacks against a temporary Raw Accel folder
//! whose writer.exe is a stand-in script (Unix only, like tests/cli.rs), with a screenshot of each state in
//! target/tmp/screenshots. Slint takes one platform per process, so this is one test that walks through the states.
#![cfg(unix)]

use serde_json::Value;
use slint::{ComponentHandle, Model};
use spraylab_direction::app::{self, Env, Job, Source};
use spraylab_direction::gui::{headless, Gui, Host, Setup, Tone};
use spraylab_direction::hotkey::Hotkey;
use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::rc::Rc;

const SETTINGS: &str = include_str!("fixtures/rawaccel-1.7-settings.json");
const PROFILE: &str = include_str!("fixtures/spraylab-direction-profile.json");
const DPI: &str = "Output DPI";

#[derive(Default)]
struct World {
    cs2: Cell<bool>,
    raw_accel_window: Cell<bool>,
    picks: RefCell<VecDeque<PathBuf>>,
    beeps: RefCell<Vec<Tone>>,
    hotkeys: RefCell<Vec<Option<String>>>,
    startup: Cell<bool>,
    taken: RefCell<Option<String>>,
}

struct FakeHost(Rc<World>);

impl Host for FakeHost {
    fn running(&self, names: &[&str]) -> Vec<bool> {
        names.iter().map(|name| (*name == "cs2.exe" && self.0.cs2.get()) || (*name == "rawaccel.exe" && self.0.raw_accel_window.get())).collect()
    }
    fn pick_file(&self, _title: &str, _filters: &[(&str, &str)], _start: Option<&Path>) -> Option<PathBuf> {
        self.0.picks.borrow_mut().pop_front()
    }
    fn startup(&self) -> Option<bool> {
        Some(self.0.startup.get())
    }
    fn set_startup(&self, on: bool) -> Result<(), String> {
        self.0.startup.set(on);
        Ok(())
    }
    fn register_hotkey(&self, hotkey: Option<&Hotkey>) -> Result<(), String> {
        let name = hotkey.map(|hotkey| hotkey.name.clone());
        self.0.hotkeys.borrow_mut().push(name.clone());
        match (&*self.0.taken.borrow(), name) {
            (Some(taken), Some(name)) if *taken == name => Err(format!("{name} is in use by another program")),
            _ => Ok(()),
        }
    }
    fn beep(&self, tone: Tone) {
        self.0.beeps.borrow_mut().push(tone);
    }
    fn open_url(&self, _url: &str) {}
    fn raise(&self, _window: &slint::Window) {}
    fn tray_icon_size(&self) -> u32 {
        24
    }
}

struct Folders {
    root: PathBuf,
    raw: PathBuf,
    downloads: PathBuf,
}

impl Folders {
    fn new() -> Folders {
        let root = std::env::temp_dir().join(format!("spraylab-direction-gui-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let (raw, downloads) = (root.join("Raw Accel"), root.join("Downloads"));
        fs::create_dir_all(&raw).unwrap();
        fs::create_dir_all(&downloads).unwrap();
        fs::write(raw.join("settings.json"), SETTINGS).unwrap();
        let writer = raw.join("writer.exe");
        fs::write(&writer, "#!/bin/sh\ndir=$(dirname \"$0\")\necho \"$1\" >> \"$dir/writer.log\"\nexit $(cat \"$dir/writer-exit\" 2>/dev/null || echo 0)\n").unwrap();
        fs::set_permissions(&writer, fs::Permissions::from_mode(0o755)).unwrap();
        fs::write(downloads.join("spraylab-direction-profile.json"), PROFILE).unwrap();
        Folders { root, raw, downloads }
    }

    fn settings(&self) -> String {
        fs::read_to_string(self.raw.join("settings.json")).unwrap()
    }

    fn dpi(&self) -> f64 {
        serde_json::from_str::<Value>(&self.settings()).unwrap()["profiles"][0][DPI].as_f64().unwrap()
    }
}

impl Drop for Folders {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn screenshot(screen: &slint::platform::software_renderer::MinimalSoftwareWindow, name: &str) {
    let (width, height) = (960, 700);
    let pixels = headless::render(screen, width, height, 1.0);
    let folder = Path::new(env!("CARGO_TARGET_TMPDIR")).join("screenshots");
    fs::create_dir_all(&folder).unwrap();
    let file = fs::File::create(folder.join(format!("{name}.png"))).unwrap();
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.write_header().unwrap().write_image_data(&pixels).unwrap();
    // Something was drawn: the window background is not all one colour.
    assert!(pixels.chunks(4).any(|pixel| pixel != &pixels[..4]), "{name} is blank");
}

#[test]
fn the_window_switches_the_profile_and_shows_each_state() {
    let folders = Folders::new();
    let world = Rc::new(World::default());
    let screen = headless::install();
    let env = Env { home: folders.root.join("home"), downloads: Some(folders.downloads.clone()) };
    let gui = Gui::new(env, Box::new(FakeHost(world.clone())), Setup { inline_jobs: true, tick: None, tray: true }).unwrap();
    gui.window.show().unwrap();
    let display = || gui.window.get_display();
    // The Raw Accel table's first line, Output DPI: (yours, with the profile or now).
    let dpi_row = || display().raw_rows.row_data(0).map(|row| (row.yours.to_string(), row.other.to_string()));
    assert_eq!(world.hotkeys.borrow().as_slice(), [Some("ctrl+alt+p".to_string())]);

    // The test program's own folder has no Raw Accel: set up, with Locate.
    assert_eq!((display().phase, display().can_locate), (app::SETUP, true));
    assert!(display().summary.contains("cannot find it"), "{}", display().summary);
    screenshot(&screen, "1-set-up-raw-accel");

    world.picks.borrow_mut().push_back(folders.raw.join("writer.exe"));
    gui.window.invoke_locate();
    let shown = display();
    assert_eq!((shown.phase, shown.state.as_str(), shown.action.as_str()), (app::OFF, "OFF", "TURN ON"));
    assert_eq!((shown.right.as_str(), shown.left.as_str(), shown.rotation.as_str()), ("+3.4%", "\u{2212}3.3%", "+1.25°"));
    assert_eq!((shown.right_sign, shown.left_sign, shown.flicks.as_str()), (1, -1, "96 FLICKS"));
    assert_eq!((dpi_row(), shown.raw_other.as_str(), shown.raw_version.as_str()), (Some(("1000".into(), "1034.1".into())), "WITH PROFILE", "V1.7"));
    assert_eq!(shown.hint.as_str(), "Ctrl+Alt+P switches it from anywhere, in game too.");
    screenshot(&screen, "2-off");

    gui.window.invoke_act();
    let shown = display();
    assert_eq!((shown.phase, shown.state.as_str(), shown.action.as_str(), shown.raw_other.as_str()), (app::ON, "ON", "TURN OFF", "NOW"));
    assert_eq!(folders.dpi(), 1034.1);
    assert!(shown.message.contains("Kept a copy") && shown.message.contains("The SprayLab profile is on"), "{}", shown.message);
    assert!(!shown.error);
    let tray = gui.tray().unwrap();
    assert!(tray.get_on() && tray.get_tip().contains("on"), "{}", tray.get_tip());
    assert_eq!(tray.get_hotkey_text().as_str(), "Ctrl+Alt+P");
    screenshot(&screen, "3-on");

    // A lower strength while on asks to update, then applies on top of the same own values.
    gui.window.invoke_strength_chosen(50.0);
    assert!(display().update && display().tag == "CHANGES NOT APPLIED" && display().tag_tone == app::AMBER);
    screenshot(&screen, "4-on-strength-changed");
    gui.window.invoke_update_profile();
    assert!(!display().update);
    assert!((folders.dpi() - 1000.0 * 1.0341f64.sqrt()).abs() < 1e-3, "{}", folders.dpi());
    gui.window.invoke_strength_chosen(100.0);
    gui.window.invoke_update_profile();

    // The hotkey switches off, with the low beep, and settings.json is exactly as it was.
    gui.hotkey();
    assert_eq!(display().phase, app::OFF);
    assert_eq!(folders.settings(), SETTINGS);
    assert_eq!(world.beeps.borrow().as_slice(), [Tone::Off]);

    // On only while CS2 runs.
    gui.window.invoke_cs2_only_toggled(true);
    assert_eq!((display().state.as_str(), display().tag.as_str()), ("OFF", "WAITING FOR CS2"));
    world.cs2.set(true);
    gui.tick();
    assert_eq!((display().phase, display().tag.as_str()), (app::ON, "CS2 RUNNING"));
    world.cs2.set(false);
    gui.tick();
    assert_eq!(display().phase, app::OFF);
    gui.window.invoke_cs2_only_toggled(false);

    // Raw Accel's values changed while on (as Apply in its window does): restore or keep.
    gui.window.invoke_act();
    fs::write(folders.raw.join("settings.json"), folders.settings().replace(r#""Output DPI": 1034.1"#, r#""Output DPI": 1100.0"#)).unwrap();
    world.raw_accel_window.set(true);
    gui.show();
    gui.tick();
    let shown = display();
    assert_eq!((shown.phase, shown.state.as_str()), (app::CHANGED, "CHECK RAW ACCEL"));
    // Yours are the values from before the profile; Raw Accel now has the changed ones.
    assert_eq!(dpi_row(), Some(("1000".into(), "1100".into())));
    assert!(shown.warning.contains("Raw Accel's window is open"));
    screenshot(&screen, "5-changed-outside");
    gui.window.invoke_keep();
    assert_eq!(display().phase, app::OFF);
    assert_eq!(dpi_row().map(|(yours, _)| yours), Some("1100".into()));
    world.raw_accel_window.set(false);
    gui.tick();

    // A writer.exe that fails leaves settings.json alone and says so.
    fs::write(folders.raw.join("writer-exit"), "1").unwrap();
    let before = folders.settings();
    gui.window.invoke_act();
    let shown = display();
    assert!(shown.error && shown.message.contains("back as it was"), "{}", shown.message);
    assert_eq!((shown.phase, folders.settings()), (app::OFF, before));
    screenshot(&screen, "6-writer-failed");
    fs::remove_file(folders.raw.join("writer-exit")).unwrap();

    // Switching in progress, as the window shows it while writer.exe runs.
    gui.controller.borrow_mut().busy = Some((Job::On, Source::Window));
    gui.render();
    assert_eq!((display().phase, display().action_enabled), (app::WORKING, false));
    screenshot(&screen, "7-switching");
    gui.controller.borrow_mut().busy = None;

    // A taken hotkey is reported; None registers nothing.
    *world.taken.borrow_mut() = Some("f8".into());
    let f8 = app::HOTKEYS.iter().position(|name| *name == "f8").unwrap() as i32;
    gui.window.invoke_hotkey_chosen(f8);
    assert!(display().warning.contains("f8 is in use"), "{}", display().warning);
    gui.window.invoke_hotkey_chosen(app::HOTKEYS.len() as i32 - 1);
    assert_eq!(world.hotkeys.borrow().last().unwrap(), &None);
    assert!(!display().warning.contains("in use"));

    // Start with Windows goes through the host.
    gui.window.invoke_startup_toggled(true);
    assert!(world.startup.get() && gui.window.get_startup());

    // A newer download is offered; Use it picks it.
    let newer = PROFILE.replace("2026-10-29", "2026-10-30");
    fs::write(folders.downloads.join("spraylab-direction-profile (1).json"), newer).unwrap();
    gui.tick();
    assert!(display().newer.contains("made 2026-10-30") && display().message.is_empty(), "{} / {}", display().newer, display().message);
    screenshot(&screen, "8-newer-download");
    gui.window.invoke_use_newer();
    assert!(display().newer.is_empty());
    assert_eq!(display().profile_name.as_str(), "spraylab-direction-profile (1).json");

    // Without any profile file: set up, with Choose file.
    for entry in fs::read_dir(&folders.downloads).unwrap() {
        fs::remove_file(entry.unwrap().path()).unwrap();
    }
    fs::remove_file(folders.raw.join("spraylab-direction-profile.json")).unwrap();
    gui.tick();
    assert_eq!((display().phase, display().can_locate), (app::SETUP, false));
    screenshot(&screen, "9-set-up-profile");

    // The options were kept for the next start.
    let saved: Value = serde_json::from_str(&fs::read_to_string(folders.root.join("home").join("options.json")).unwrap()).unwrap();
    assert_eq!((saved["rawAccel"].as_str().map(|path| path.ends_with("Raw Accel")), saved["hotkey"].as_str()), (Some(true), Some("")));
    assert!(fs::read_to_string(folders.root.join("home").join("log.txt")).unwrap().contains("On (Window)"));
}

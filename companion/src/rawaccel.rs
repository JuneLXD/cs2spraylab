//! Raw Accel's settings.json (the `DriverConfig` its wrapper/wrapper.cpp serializes) and writer.exe, which sends a settings
//! file to the driver. The driver keeps no settings of its own across restarts: Raw Accel's window or `writer.exe
//! settings.json` applies settings.json again, so a profile written into that file stays in effect the way the rest of
//! your Raw Accel setup does.

use crate::profile::Direction;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const SETTINGS: &str = "settings.json";
pub const WRITER: &str = "writer.exe";

/// The settings.json names of the five values a direction profile changes, which Raw Accel renamed in 1.7.
#[derive(Debug, PartialEq)]
pub struct Schema {
    pub version: &'static str,
    /// Output DPI (1000 is 1x) in 1.7, the sensitivity multiplier (1 is 1x) in 1.6.
    pub scale: &'static str,
    pub yx: &'static str,
    pub lr: &'static str,
    pub ud: &'static str,
    pub rotation: &'static str,
}

pub static SCHEMAS: [Schema; 2] = [
    Schema {
        version: "1.7",
        scale: "Output DPI",
        yx: "Y/X output DPI ratio (vertical sens multiplier)",
        lr: "L/R output DPI ratio (left sens multiplier)",
        ud: "U/D output DPI ratio (up sens multiplier)",
        rotation: "Degrees of rotation",
    },
    Schema {
        version: "1.6",
        scale: "Sensitivity multiplier",
        yx: "Y/X sensitivity ratio (vertical sens multiplier)",
        lr: "L/R sensitivity ratio (left sens multiplier)",
        ud: "U/D sensitivity ratio (up sens multiplier)",
        rotation: "Degrees of rotation",
    },
];

/// The five values of one Raw Accel profile that a direction profile changes.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Fields {
    pub scale: f64,
    pub yx: f64,
    pub lr: f64,
    pub ud: f64,
    pub rotation: f64,
}

impl Fields {
    /// These values with a direction profile on top. Raw Accel's `modify` (common/rawaccel.hpp) rotates the input, applies
    /// its curve and Output DPI (or sensitivity), multiplies y by Y/X, then negative x by L/R and negative y by U/D. So per
    /// direction the multipliers multiply, and the rotations add; a Y/X below zero mirrors the screen, which turns a rotation
    /// the other way. Exact when these values scale every direction alike (Y/X, L/R and U/D of 1 or -1); otherwise adding a
    /// rotation is off by about the rotation times their unevenness.
    pub fn with(self, p: Direction) -> Fields {
        Fields {
            scale: self.scale * p.right,
            yx: self.yx * p.down / p.right,
            lr: self.lr * p.left / p.right,
            ud: self.ud * p.up / p.down,
            rotation: self.rotation + self.yx.signum() * p.rotation,
        }
        .rounded()
    }

    /// The direction profile that turns `base` into these values (the inverse of `with`).
    pub fn relative_to(&self, base: &Fields) -> Direction {
        let right = self.scale / base.scale;
        let down = right * self.yx / base.yx;
        Direction {
            rotation: base.yx.signum() * (self.rotation - base.rotation),
            right,
            left: right * self.lr / base.lr,
            up: down * self.ud / base.ud,
            down,
        }
    }

    /// Rounded to six places: far finer than any sensitivity difference, short enough to read in the file.
    pub fn rounded(self) -> Fields {
        let r = |value: f64| (value * 1e6).round() / 1e6;
        Fields { scale: r(self.scale), yx: r(self.yx), lr: r(self.lr), ud: r(self.ud), rotation: r(self.rotation) }
    }

    /// The same values, up to the rounding of a JSON round trip.
    pub fn close(&self, other: &Fields) -> bool {
        let near = |a: f64, b: f64| (a - b).abs() <= 1e-7 * a.abs().max(b.abs()).max(1.0);
        near(self.scale, other.scale) && near(self.yx, other.yx) && near(self.lr, other.lr) && near(self.ud, other.ud) && near(self.rotation, other.rotation)
    }

    /// How much more these values scale the fastest of the four directions than the slowest (0.1 is 10% more). A rotation
    /// added on top is off by about the rotation in radians times this.
    pub fn spread(&self) -> f64 {
        let gains = [1.0, self.lr, self.yx.abs(), self.yx.abs() * self.ud];
        let (low, high) = gains.iter().fold((f64::INFINITY, 0.0f64), |(low, high), gain| (low.min(*gain), high.max(*gain)));
        high / low - 1.0
    }

    /// Whether these values scale directions differently (beyond 1%), which makes adding a rotation on top approximate.
    pub fn uneven(&self) -> bool {
        self.spread() > 0.01
    }

    /// What Raw Accel's validator (common/rawaccel-validate.hpp) requires, and finite numbers.
    pub fn check(&self) -> Result<(), String> {
        let finite = [self.scale, self.yx, self.lr, self.ud, self.rotation].iter().all(|value| value.is_finite());
        if !finite || self.scale == 0.0 || self.yx == 0.0 || self.lr <= 0.0 || self.ud <= 0.0 {
            return Err(format!("Raw Accel would refuse these values: {}", self.describe(&SCHEMAS[0])));
        }
        Ok(())
    }

    pub fn describe(&self, schema: &Schema) -> String {
        let scale = if schema.version == "1.6" { "sensitivity" } else { "Output DPI" };
        format!("{scale} {}, Y/X {}, L/R {}, U/D {}, rotation {} deg", short(self.scale), short(self.yx), short(self.lr), short(self.ud), short(self.rotation))
    }
}

/// A value with up to six decimals and no trailing zeros.
pub fn short(value: f64) -> String {
    let text = format!("{value:.6}");
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// A parsed settings.json, written back with its own key order, line endings and byte order mark.
#[derive(Debug)]
pub struct Settings {
    root: Value,
    pub schema: &'static Schema,
    crlf: bool,
    trailing_newline: bool,
    bom: bool,
}

impl Settings {
    pub fn parse(text: &str) -> Result<Settings, String> {
        let bom = text.starts_with('\u{feff}');
        let body = text.trim_start_matches('\u{feff}');
        let root: Value = serde_json::from_str(body)
            .map_err(|error| format!("Raw Accel's settings.json is not valid JSON ({error}). Open Raw Accel and press Apply to rewrite it."))?;
        let profiles = root.get("profiles").and_then(Value::as_array).ok_or("Raw Accel's settings.json has no profiles list.")?;
        let first = profiles.first().ok_or("Raw Accel's settings.json has no profile yet: open Raw Accel and press Apply once.")?;
        let schema = SCHEMAS.iter().find(|schema| first.get(schema.scale).is_some()).ok_or(
            "This settings.json is from a Raw Accel version this program does not know (it has neither \"Output DPI\" nor \"Sensitivity multiplier\"). Raw Accel 1.6 and 1.7 are supported.",
        )?;
        Ok(Settings { root, schema, crlf: body.contains("\r\n"), trailing_newline: body.ends_with('\n'), bom })
    }

    pub fn names(&self) -> Vec<String> {
        self.profiles().iter().map(|profile| profile.get("name").and_then(Value::as_str).unwrap_or("").to_string()).collect()
    }

    fn profiles(&self) -> &Vec<Value> {
        self.root["profiles"].as_array().expect("checked when parsed")
    }

    /// The profile to change: the named one, or the first, which Raw Accel uses for every mouse not assigned another.
    pub fn select(&self, name: Option<&str>) -> Result<usize, String> {
        let names = self.names();
        match name {
            None => Ok(0),
            Some(wanted) => names.iter().position(|name| name == wanted).ok_or_else(|| {
                format!("Raw Accel's settings.json has no profile named \"{wanted}\". Its profiles: {}.", names.join(", "))
            }),
        }
    }

    pub fn fields(&self, index: usize) -> Result<Fields, String> {
        let profile = &self.profiles()[index];
        let name = self.names()[index].clone();
        let get = |key: &str| profile.get(key).and_then(Value::as_f64).ok_or_else(|| format!("Raw Accel profile \"{name}\" has no number \"{key}\"."));
        let s = self.schema;
        Ok(Fields { scale: get(s.scale)?, yx: get(s.yx)?, lr: get(s.lr)?, ud: get(s.ud)?, rotation: get(s.rotation)? })
    }

    /// Sets the five values in place; every other value and the key order stay as they were.
    pub fn set(&mut self, index: usize, fields: &Fields) -> Result<(), String> {
        fields.check()?;
        let s = self.schema;
        let profile = self.root["profiles"][index].as_object_mut().ok_or("A Raw Accel profile is not an object.")?;
        for (key, value) in [(s.scale, fields.scale), (s.yx, fields.yx), (s.lr, fields.lr), (s.ud, fields.ud), (s.rotation, fields.rotation)] {
            profile.insert(key.to_string(), Value::from(value));
        }
        Ok(())
    }

    /// The file as Raw Accel writes it: two-space indents, its line endings.
    pub fn text(&self) -> String {
        let mut text = serde_json::to_string_pretty(&self.root).expect("JSON values always serialize");
        if self.trailing_newline {
            text.push('\n');
        }
        if self.crlf {
            text = text.replace('\n', "\r\n");
        }
        if self.bom {
            text.insert(0, '\u{feff}');
        }
        text
    }
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// Replaces `path` with `text` in one step, so a crash never leaves Raw Accel a half-written file.
pub fn replace_file(path: &Path, text: &str) -> io::Result<()> {
    let temporary = sibling(path, ".spraylab-tmp");
    fs::write(&temporary, text)?;
    fs::rename(&temporary, path)
}

/// Keeps a copy of settings.json from before this program first changed it, and never overwrites that copy.
pub fn backup_once(path: &Path) -> io::Result<Option<PathBuf>> {
    let backup = sibling(path, ".spraylab-backup");
    if backup.exists() {
        return Ok(None);
    }
    fs::copy(path, &backup)?;
    Ok(Some(backup))
}

/// Raw Accel's folder: the one given, else this program's own folder or the current one, whichever has writer.exe. Always
/// absolute (but not resolved to a \\?\ path), because writer.exe runs in that folder and gets the settings path from here.
pub fn find_folder(explicit: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(folder) = explicit {
        let folder = std::path::absolute(folder).map_err(|error| format!("Cannot use {}: {error}", folder.display()))?;
        return if folder.join(WRITER).is_file() {
            Ok(folder)
        } else {
            Err(format!("{} has no writer.exe, so it is not Raw Accel's folder.", folder.display()))
        };
    }
    let own = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf));
    [own, std::env::current_dir().ok()].into_iter().flatten().find(|folder| folder.join(WRITER).is_file()).ok_or_else(|| {
        "Cannot find Raw Accel. Put SprayLab Direction in Raw Accel's folder, next to writer.exe and settings.json, or choose that folder (--rawaccel FOLDER on the command line).".to_string()
    })
}

/// Sends settings.json to the driver with Raw Accel's own writer.exe. The driver waits a second before taking new settings
/// (its anti-cheat safeguard), so this takes a little over a second. On an error writer.exe shows a message box and exits 1.
pub fn activate(folder: &Path, settings: &Path) -> Result<(), String> {
    let mut writer = Command::new(folder.join(WRITER));
    writer.arg(settings).current_dir(folder);
    // No console window for it: one popping up while switching in game could take the focus from a fullscreen game.
    // (Its message boxes still show.)
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut writer, 0x0800_0000);
    let status = writer.status().map_err(|error| format!("Cannot run Raw Accel's writer.exe: {error}."))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Raw Accel's writer.exe did not take the settings ({status}); its message box says why. Raw Accel's driver must be installed (installer.exe, then restart Windows)."
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEFAULT_17: &str = include_str!("../tests/fixtures/rawaccel-1.7-settings.json");

    /// Raw Accel's `modify` for these values without an acceleration curve.
    fn raw_accel(f: &Fields, x: f64, y: f64) -> (f64, f64) {
        let (sin, cos) = f.rotation.to_radians().sin_cos();
        let (mut x, mut y) = (x * cos - y * sin, x * sin + y * cos);
        x *= f.scale;
        y *= f.scale * f.yx;
        if x < 0.0 {
            x *= f.lr;
        }
        if y < 0.0 {
            y *= f.ud;
        }
        (x, y)
    }

    /// SprayLab's `applyDirectionProfile`.
    fn spraylab(p: &Direction, x: f64, y: f64) -> (f64, f64) {
        let (sin, cos) = p.rotation.to_radians().sin_cos();
        let (x, y) = (x * cos - y * sin, x * sin + y * cos);
        (x * if x < 0.0 { p.left } else { p.right }, y * if y < 0.0 { p.up } else { p.down })
    }

    const PROFILE: Direction = Direction { rotation: 1.25, right: 1.0341, left: 0.9671, up: 1.0836, down: 1.0015 };

    #[test]
    fn composing_equals_applying_the_profile_to_what_raw_accel_outputs() {
        // SprayLab measured the hand through your current Raw Accel settings, so the profile must act on their output.
        let bases = [
            Fields { scale: 1000.0, yx: 1.0, lr: 1.0, ud: 1.0, rotation: 0.0 },
            Fields { scale: 800.0, yx: 1.0, lr: 1.0, ud: 1.0, rotation: -3.0 },
            Fields { scale: 1.6, yx: -1.0, lr: 1.0, ud: 1.0, rotation: 2.0 },
            Fields { scale: -1000.0, yx: 1.0, lr: 1.0, ud: 1.0, rotation: 0.0 },
        ];
        for base in bases {
            let composed = base.with(PROFILE);
            for i in 0..64 {
                let angle = i as f64 * std::f64::consts::TAU / 64.0;
                let (hx, hy) = (7.0 * angle.cos(), 7.0 * angle.sin());
                let (bx, by) = raw_accel(&base, hx, hy);
                let expected = spraylab(&PROFILE, bx, by);
                let actual = raw_accel(&composed, hx, hy);
                let size = base.scale.abs() * 7.0;
                assert!((actual.0 - expected.0).abs() < 1e-5 * size && (actual.1 - expected.1).abs() < 1e-5 * size, "{base:?} at {angle}");
            }
        }
    }

    #[test]
    fn with_an_uneven_base_the_added_rotation_is_close() {
        let base = Fields { scale: 1000.0, yx: 1.1, lr: 0.95, ud: 1.05, rotation: 0.0 };
        assert!(base.uneven());
        let composed = base.with(PROFILE);
        let mut worst: f64 = 0.0;
        for i in 0..64 {
            let angle = i as f64 * std::f64::consts::TAU / 64.0;
            let (bx, by) = raw_accel(&base, angle.cos(), angle.sin());
            let (ex, ey) = spraylab(&PROFILE, bx, by);
            let (ax, ay) = raw_accel(&composed, angle.cos(), angle.sin());
            worst = worst.max((ax - ex).hypot(ay - ey) / ex.hypot(ey));
        }
        // About the rotation (0.022 rad) times the spread between directions (up 1.155 against left 0.95, 22%).
        let estimate = PROFILE.rotation.to_radians() * base.spread();
        assert!(worst > 0.5 * estimate && worst < 1.5 * estimate, "{worst} against {estimate}");
    }

    #[test]
    fn relative_to_undoes_with() {
        for base in [Fields { scale: 1000.0, yx: 1.0, lr: 1.0, ud: 1.0, rotation: 0.0 }, Fields { scale: 1.2, yx: -0.9, lr: 1.1, ud: 0.95, rotation: 4.0 }] {
            let back = base.with(PROFILE).relative_to(&base);
            for (a, b) in [(back.rotation, PROFILE.rotation), (back.right, PROFILE.right), (back.left, PROFILE.left), (back.up, PROFILE.up), (back.down, PROFILE.down)] {
                assert!((a - b).abs() < 1e-5, "{back:?}");
            }
        }
    }

    #[test]
    fn reads_and_writes_raw_accel_17_settings_keeping_everything_else() {
        let mut settings = Settings::parse(DEFAULT_17).unwrap();
        assert_eq!(settings.schema.version, "1.7");
        assert_eq!(settings.names(), ["default"]);
        let base = settings.fields(0).unwrap();
        assert_eq!(base, Fields { scale: 1000.0, yx: 1.0, lr: 1.0, ud: 1.0, rotation: 0.0 });
        let composed = base.with(PROFILE);
        settings.set(0, &composed).unwrap();
        let text = settings.text();
        let again = Settings::parse(&text).unwrap();
        assert_eq!(again.fields(0).unwrap(), composed);
        assert_eq!(composed.scale, 1034.1);
        // Only the five values changed, and every key kept its place.
        let (before, after): (Value, Value) = (serde_json::from_str(DEFAULT_17).unwrap(), serde_json::from_str(&text).unwrap());
        let keys = |value: &Value| value["profiles"][0].as_object().unwrap().keys().cloned().collect::<Vec<_>>();
        assert_eq!(keys(&before), keys(&after));
        let mut restored = after.clone();
        for key in [settings.schema.scale, settings.schema.yx, settings.schema.lr, settings.schema.ud, settings.schema.rotation] {
            restored["profiles"][0][key] = before["profiles"][0][key].clone();
        }
        assert_eq!(restored, before);
        assert_eq!(text.trim_end(), DEFAULT_17.trim_end().replace(r#""Output DPI": 1000.0"#, r#""Output DPI": 1034.1"#)
            .replace(r#""Y/X output DPI ratio (vertical sens multiplier)": 1.0"#, &format!(r#""Y/X output DPI ratio (vertical sens multiplier)": {}"#, composed.yx))
            .replace(r#""L/R output DPI ratio (left sens multiplier)": 1.0"#, &format!(r#""L/R output DPI ratio (left sens multiplier)": {}"#, composed.lr))
            .replace(r#""U/D output DPI ratio (up sens multiplier)": 1.0"#, &format!(r#""U/D output DPI ratio (up sens multiplier)": {}"#, composed.ud))
            .replace(r#""Degrees of rotation": 0.0"#, r#""Degrees of rotation": 1.25"#));
    }

    #[test]
    fn keeps_windows_line_endings_and_a_byte_order_mark() {
        let windows = format!("\u{feff}{}", DEFAULT_17.replace('\n', "\r\n"));
        let settings = Settings::parse(&windows).unwrap();
        assert_eq!(settings.text(), windows);
    }

    #[test]
    fn reads_raw_accel_16_names() {
        let old = DEFAULT_17
            .replace(r#""Output DPI": 1000.0"#, r#""Sensitivity multiplier": 1.5"#)
            .replace("output DPI ratio", "sensitivity ratio");
        let mut settings = Settings::parse(&old).unwrap();
        assert_eq!(settings.schema.version, "1.6");
        let base = settings.fields(0).unwrap();
        assert_eq!(base.scale, 1.5);
        settings.set(0, &base.with(PROFILE)).unwrap();
        assert!(settings.text().contains(r#""Sensitivity multiplier": 1.55115"#));
    }

    #[test]
    fn picks_profiles_by_name_and_refuses_unknown_files() {
        let mut value: Value = serde_json::from_str(DEFAULT_17).unwrap();
        let mut second = value["profiles"][0].clone();
        second["name"] = "cs2".into();
        second["Output DPI"] = 800.0.into();
        value["profiles"].as_array_mut().unwrap().push(second);
        let settings = Settings::parse(&value.to_string()).unwrap();
        assert_eq!(settings.select(None).unwrap(), 0);
        assert_eq!(settings.fields(settings.select(Some("cs2")).unwrap()).unwrap().scale, 800.0);
        assert!(settings.select(Some("missing")).unwrap_err().contains("default, cs2"));
        assert!(Settings::parse(r#"{"profiles": []}"#).unwrap_err().contains("press Apply once"));
        assert!(Settings::parse(r#"{"profiles": [{"name": "x"}]}"#).unwrap_err().contains("1.6 and 1.7"));
        assert!(Settings::parse("not json").is_err());
    }

    #[test]
    fn refuses_values_raw_accel_would_reject() {
        assert!(Fields { scale: 1000.0, yx: 1.0, lr: 0.0, ud: 1.0, rotation: 0.0 }.check().is_err());
        assert!(Fields { scale: f64::NAN, yx: 1.0, lr: 1.0, ud: 1.0, rotation: 0.0 }.check().is_err());
        assert!(Fields { scale: 1000.0, yx: -1.0, lr: 1.0, ud: 1.0, rotation: 0.0 }.check().is_ok());
    }
}

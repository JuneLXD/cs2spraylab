//! The profile file SprayLab's Direction Calibration panel downloads (`directionProfileFile` in src/range/aim-vector.ts): the
//! direction profile to apply, with SprayLab's strength slider already in it, and the evidence behind it.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub const FORMAT: &str = "spraylab-direction-profile";
/// The name SprayLab downloads it under; browsers add " (1)" and so on for repeats.
pub const FILE_PREFIX: &str = "spraylab-direction-profile";
/// SprayLab's limits (`directionLimits`): multipliers from 0.8 to 1.25, rotation up to 10 degrees either way.
pub const GAIN_LIMITS: (f64, f64) = (0.8, 1.25);
pub const ROTATION_LIMIT: f64 = 10.0;

/// A direction profile in Raw Accel's order: rotate mouse input by `rotation` degrees (positive turns it clockwise on screen),
/// then multiply movement to the right, left, up and down.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Direction {
    pub rotation: f64,
    pub right: f64,
    pub left: f64,
    pub up: f64,
    pub down: f64,
}

impl Direction {
    pub const NEUTRAL: Direction = Direction { rotation: 0.0, right: 1.0, left: 1.0, up: 1.0, down: 1.0 };

    /// `strength` (0 to 1) of this profile, as SprayLab's `scaleProfile`: the rotation scales linearly, the multipliers
    /// geometrically.
    pub fn scaled(self, strength: f64) -> Direction {
        let s = strength.clamp(0.0, 1.0);
        Direction { rotation: self.rotation * s, right: self.right.powf(s), left: self.left.powf(s), up: self.up.powf(s), down: self.down.powf(s) }
    }

    pub fn is_neutral(&self) -> bool {
        let d = Direction::NEUTRAL;
        (self.rotation - d.rotation).abs() < 1e-9
            && [self.right, self.left, self.up, self.down].iter().all(|gain| (gain - 1.0).abs() < 1e-9)
    }

    /// Refuses values SprayLab never produces, so a damaged or hand-edited file cannot change sensitivity wildly.
    pub fn check(&self) -> Result<(), String> {
        if !self.rotation.is_finite() || self.rotation.abs() > ROTATION_LIMIT + 1e-9 {
            return Err(format!("its rotation {} is outside SprayLab's limit of {ROTATION_LIMIT} degrees", self.rotation));
        }
        for (name, gain) in [("right", self.right), ("left", self.left), ("up", self.up), ("down", self.down)] {
            if !gain.is_finite() || gain < GAIN_LIMITS.0 - 1e-9 || gain > GAIN_LIMITS.1 + 1e-9 {
                return Err(format!("its {name} multiplier {gain} is outside SprayLab's limits of {} to {}", GAIN_LIMITS.0, GAIN_LIMITS.1));
            }
        }
        Ok(())
    }

    /// One line for the console, e.g. `right x1.0341, left x0.9671, up x1.0836, down x1.0015, rotation +1.25 deg`.
    pub fn describe(&self) -> String {
        format!("right x{:.4}, left x{:.4}, up x{:.4}, down x{:.4}, rotation {:+.2} deg", self.right, self.left, self.up, self.down, self.rotation)
    }
}

/// A downloaded profile file.
#[derive(Clone, Debug)]
pub struct ProfileFile {
    pub direction: Direction,
    pub flicks: u64,
    pub strength: f64,
    pub created: String,
}

pub fn parse(text: &str) -> Result<ProfileFile, String> {
    let value: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|error| format!("it is not valid JSON ({error})"))?;
    if value.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err("it is not a SprayLab direction profile".into());
    }
    match value.get("version").and_then(Value::as_u64) {
        Some(1) => {}
        Some(version) => return Err(format!("it is version {version} of the format; this program reads version 1, so update it")),
        None => return Err("it has no format version".into()),
    }
    let direction: Direction = serde_json::from_value(value.get("profile").cloned().unwrap_or(Value::Null))
        .map_err(|error| format!("its profile is incomplete ({error})"))?;
    direction.check()?;
    if let Some(fields) = value.get("rawAccel") {
        check_raw_accel_fields(&direction, fields)?;
    }
    Ok(ProfileFile {
        direction,
        flicks: value.get("flicks").and_then(Value::as_u64).unwrap_or(0),
        strength: value.get("strength").and_then(Value::as_f64).unwrap_or(1.0),
        created: value.get("created").and_then(Value::as_str).unwrap_or("").to_string(),
    })
}

/// The Raw Accel fields SprayLab writes beside the profile (`rawAccelFields`, rounded to 2 or 4 places) must say the same as
/// the profile; a mismatch means the file was edited.
fn check_raw_accel_fields(p: &Direction, fields: &Value) -> Result<(), String> {
    let expected = [
        ("Output DPI", 1000.0 * p.right, 0.5),
        ("Y/X output DPI ratio (vertical sens multiplier)", p.down / p.right, 0.002),
        ("L/R output DPI ratio (left sens multiplier)", p.left / p.right, 0.002),
        ("U/D output DPI ratio (up sens multiplier)", p.up / p.down, 0.002),
        ("Degrees of rotation", p.rotation, 0.01),
    ];
    for (key, value, tolerance) in expected {
        match fields.get(key).and_then(Value::as_f64) {
            Some(written) if (written - value).abs() <= tolerance => {}
            Some(written) => return Err(format!("its Raw Accel field \"{key}\" ({written}) does not match its profile ({value:.4}); was it edited?")),
            None => return Err(format!("its Raw Accel fields lack \"{key}\"")),
        }
    }
    Ok(())
}

pub fn load(path: &Path) -> Result<ProfileFile, String> {
    let text = fs::read_to_string(path).map_err(|error| format!("Cannot read the profile {}: {error}", path.display()))?;
    parse(&text).map_err(|error| format!("{} cannot be used: {error}.", path.display()))
}

/// The newest downloaded profile in `folder`: SprayLab names it spraylab-direction-profile.json, and browsers add " (1)" and
/// so on when a file of that name already exists.
pub fn newest_in(folder: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(folder).ok()?;
    entries
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            name.starts_with(FILE_PREFIX) && name.ends_with(".json")
        })
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .filter(|(_, path)| path.is_file())
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

/// Your Downloads folder: %USERPROFILE%\Downloads on Windows, ~/Downloads elsewhere.
pub fn downloads_folder() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join("Downloads"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIVE: &str = include_str!("../tests/fixtures/spraylab-direction-profile.json");

    #[test]
    fn reads_the_file_spraylab_downloads() {
        let file = parse(LIVE).unwrap();
        assert_eq!(file.direction, Direction { rotation: 1.25, right: 1.0341, left: 0.9671, up: 1.0836, down: 1.0015 });
        assert_eq!((file.flicks, file.strength), (96, 1.0));
        assert!(file.created.starts_with("2026-10-29"));
    }

    #[test]
    fn refuses_other_files_newer_formats_and_values_beyond_spraylab_limits() {
        let mut value: Value = serde_json::from_str(LIVE).unwrap();
        value["format"] = "something-else".into();
        assert!(parse(&value.to_string()).unwrap_err().contains("not a SprayLab"));
        let mut value: Value = serde_json::from_str(LIVE).unwrap();
        value["version"] = 2.into();
        assert!(parse(&value.to_string()).unwrap_err().contains("update it"));
        for (key, bad) in [("right", 1.4), ("down", 0.7), ("rotation", 12.0)] {
            let mut value: Value = serde_json::from_str(LIVE).unwrap();
            value["profile"][key] = bad.into();
            value.as_object_mut().unwrap().remove("rawAccel");
            assert!(parse(&value.to_string()).unwrap_err().contains("outside"), "{key}");
        }
        assert!(parse("{").is_err());
    }

    #[test]
    fn refuses_a_profile_whose_raw_accel_fields_were_edited() {
        let mut value: Value = serde_json::from_str(LIVE).unwrap();
        value["rawAccel"]["U/D output DPI ratio (up sens multiplier)"] = 1.2.into();
        assert!(parse(&value.to_string()).unwrap_err().contains("was it edited"));
        value.as_object_mut().unwrap().remove("rawAccel");
        assert!(parse(&value.to_string()).is_ok());
    }

    #[test]
    fn scales_strength_like_spraylab() {
        let p = Direction { rotation: 2.0, right: 1.1, left: 0.9, up: 1.21, down: 0.81 };
        let half = p.scaled(0.5);
        assert!((half.rotation - 1.0).abs() < 1e-12 && (half.up - 1.1).abs() < 1e-12 && (half.down - 0.9).abs() < 1e-12);
        assert!(p.scaled(0.0).is_neutral());
        assert_eq!(p.scaled(1.0), p);
        assert_eq!(p.scaled(3.0), p);
    }

    #[test]
    fn finds_the_newest_download_including_browser_renamed_copies() {
        let dir = std::env::temp_dir().join(format!("spraylab-direction-newest-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(newest_in(&dir), None);
        fs::write(dir.join("spraylab-direction-profile.json"), LIVE).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(dir.join("spraylab-direction-profile (1).json"), LIVE).unwrap();
        fs::write(dir.join("other.json"), "{}").unwrap();
        assert_eq!(newest_in(&dir).unwrap().file_name().unwrap(), "spraylab-direction-profile (1).json");
        fs::remove_dir_all(&dir).unwrap();
    }
}

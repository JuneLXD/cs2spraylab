//! The window's settings, kept in options.json in this program's own folder: %APPDATA%\SprayLab Direction on Windows,
//! ~/.config/spraylab-direction elsewhere.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const FILE: &str = "options.json";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    /// Raw Accel's folder when chosen; none to look in this program's own folder.
    pub raw_accel: Option<PathBuf>,
    /// The Raw Accel profile to change; none for the first, which every mouse not assigned another uses.
    pub raw_accel_profile: Option<String>,
    /// The profile file chosen; none for the one last applied, else the newest download.
    pub profile: Option<PathBuf>,
    /// How much of the profile to apply, 0 to 1.
    pub strength: f64,
    /// The on/off hotkey as `hotkey::parse` reads it, such as `ctrl+alt+p`; empty for none.
    pub hotkey: String,
    /// On only while CS2 runs.
    pub cs2_only: bool,
    /// Beep when the hotkey switches.
    pub beep: bool,
}

impl Default for Options {
    fn default() -> Options {
        Options {
            raw_accel: None,
            raw_accel_profile: None,
            profile: None,
            strength: 1.0,
            hotkey: crate::hotkey::DEFAULT.into(),
            cs2_only: false,
            beep: true,
        }
    }
}

/// This program's folder for options.json and its log.
pub fn home() -> Option<PathBuf> {
    if let Some(appdata) = std::env::var_os("APPDATA") {
        return Some(PathBuf::from(appdata).join("SprayLab Direction"));
    }
    let config = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))?;
    Some(config.join("spraylab-direction"))
}

/// The options in `path`, and a note when they could not be read so the defaults apply.
pub fn load(path: &Path) -> (Options, Option<String>) {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return (Options::default(), None),
        Err(error) => return (Options::default(), Some(format!("Cannot read {} ({error}), so the default settings apply.", path.display()))),
    };
    match serde_json::from_str::<Options>(&text) {
        Ok(mut options) => {
            options.strength = if options.strength.is_finite() { options.strength.clamp(0.0, 1.0) } else { 1.0 };
            (options, None)
        }
        Err(error) => (Options::default(), Some(format!("{} is damaged ({error}), so the default settings apply.", path.display()))),
    }
}

pub fn save(path: &Path, options: &Options) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(options).expect("options always serialize") + "\n";
    crate::rawaccel::replace_file(path, &text).map_err(|error| format!("Cannot save the settings to {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_loads_and_falls_back_to_defaults() {
        let dir = std::env::temp_dir().join(format!("spraylab-direction-options-{}", std::process::id()));
        let path = dir.join("nested").join(FILE);
        assert_eq!(load(&path), (Options::default(), None));
        let options = Options { hotkey: "f8".into(), cs2_only: true, strength: 0.5, profile: Some("p.json".into()), ..Options::default() };
        save(&path, &options).unwrap();
        assert_eq!(load(&path), (options, None));
        // Missing keys take their defaults; out-of-range strength is clamped.
        fs::write(&path, r#"{"strength": 4, "beep": false}"#).unwrap();
        assert_eq!(load(&path).0, Options { strength: 1.0, beep: false, ..Options::default() });
        fs::write(&path, "{").unwrap();
        let (fallback, note) = load(&path);
        assert_eq!(fallback, Options::default());
        assert!(note.unwrap().contains("damaged"));
        fs::remove_dir_all(&dir).unwrap();
    }
}

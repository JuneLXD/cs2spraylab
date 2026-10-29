//! What this program last did to a Raw Accel folder, kept next to its settings.json: your own five values from before the
//! profile (so `off` can put them back exactly) and the values it wrote with the profile on (so it notices when something
//! else, such as Raw Accel's window, changed them since).

use crate::profile::Direction;
use crate::rawaccel::{Fields, Schema};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const STATE_FILE: &str = "spraylab-direction-state.json";
/// The copy of the last applied profile, which `run` and sign-in startup use.
pub const INSTALLED_PROFILE: &str = "spraylab-direction-profile.json";
const FORMAT: &str = "spraylab-direction-state";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub format: String,
    pub version: u32,
    /// The Raw Accel profile changed.
    pub profile_name: String,
    /// Your values from before the profile.
    pub base: Fields,
    /// The values written with the profile on; none while it is off.
    pub applied: Option<Fields>,
    /// The profile (after strength) that switching on applies.
    pub direction: Direction,
    pub source: String,
    pub flicks: u64,
}

impl State {
    pub fn new(profile_name: &str, base: Fields, applied: Option<Fields>, direction: Direction, source: &str, flicks: u64) -> State {
        State { format: FORMAT.into(), version: 1, profile_name: profile_name.into(), base, applied, direction, source: source.into(), flicks }
    }
}

pub fn load(folder: &Path) -> Result<Option<State>, String> {
    let path = folder.join(STATE_FILE);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Cannot read {}: {error}", path.display())),
    };
    let state: State = serde_json::from_str(&text).map_err(|error| format!("{} is damaged ({error}); delete it to start over.", path.display()))?;
    if state.format != FORMAT || state.version != 1 {
        return Err(format!("{} is not a state file this program reads; delete it to start over.", path.display()));
    }
    Ok(Some(state))
}

pub fn save(folder: &Path, state: &State) -> Result<(), String> {
    let path = folder.join(STATE_FILE);
    let text = serde_json::to_string_pretty(state).expect("the state always serializes") + "\n";
    crate::rawaccel::replace_file(&path, &text).map_err(|error| format!("Cannot write {}: {error}", path.display()))
}

/// Your own values, for switching the profile on: Raw Accel's current ones, unless this program's profile is on in them.
/// Returns a note to show when it had to make a choice.
pub fn base_for_on(current: &Fields, state: Option<&State>, profile_name: &str, rebase: bool, schema: &Schema) -> Result<(Fields, Option<String>), String> {
    let Some(state) = state else { return Ok((*current, None)) };
    let Some(applied) = state.applied else { return Ok((*current, None)) };
    if state.profile_name != profile_name {
        return Err(format!("The SprayLab profile is on in Raw Accel profile \"{}\": run spraylab-direction off first.", state.profile_name));
    }
    if current.close(&applied) {
        return Ok((state.base, None));
    }
    if current.close(&state.base) {
        return Ok((state.base, Some("Raw Accel had your own values back (applied from its window?), so the profile goes on top of them again.".into())));
    }
    if rebase {
        return Ok((*current, Some("Taking Raw Accel's current values as your own (--rebase).".into())));
    }
    Err(format!(
        "Raw Accel's settings changed after the SprayLab profile was applied: they are {}, but this program wrote {}.\n\
         If you changed them with the profile on, run spraylab-direction off (it puts back your own values from before the profile: {}), \
         make your change again in Raw Accel, then apply. If the current values have no profile in them, apply with --rebase to keep them as your own.",
        current.describe(schema), applied.describe(schema), state.base.describe(schema)
    ))
}

/// What switching off writes: your own values from before the profile, with a note when Raw Accel had other values since.
pub fn off_values(current: &Fields, state: &State, schema: &Schema) -> (Fields, Option<String>) {
    let changed = state.applied.is_some_and(|applied| !current.close(&applied)) && !current.close(&state.base);
    let note = changed.then(|| format!("Raw Accel's values had changed since the profile was applied ({}); putting back your own from before it.", current.describe(schema)));
    (state.base, note)
}

/// The two sets of values `run` switches between.
#[derive(Clone, Copy, Debug)]
pub struct Switch {
    pub base: Fields,
    pub on: Fields,
    pub is_on: bool,
}

impl Switch {
    /// The values to write to switch on or off, as long as Raw Accel still has what this program wrote last.
    pub fn target(&self, current: &Fields, on: bool) -> Result<Fields, String> {
        let expected = if self.is_on { self.on } else { self.base };
        if !current.close(&expected) {
            return Err("Raw Accel's settings changed outside this program, so it leaves them alone. Restart spraylab-direction run to pick them up.".into());
        }
        Ok(if on { self.on } else { self.base })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rawaccel::SCHEMAS;

    const BASE: Fields = Fields { scale: 1000.0, yx: 1.0, lr: 1.0, ud: 1.0, rotation: 0.0 };
    const P: Direction = Direction { rotation: 1.25, right: 1.0341, left: 0.9671, up: 1.0836, down: 1.0015 };

    fn on_state() -> State {
        State::new("default", BASE, Some(BASE.with(P)), P, "profile.json", 96)
    }

    #[test]
    fn the_first_apply_takes_raw_accels_values_as_yours() {
        assert_eq!(base_for_on(&BASE, None, "default", false, &SCHEMAS[0]).unwrap(), (BASE, None));
        let off = State { applied: None, ..on_state() };
        let changed = Fields { scale: 1200.0, ..BASE };
        assert_eq!(base_for_on(&changed, Some(&off), "default", false, &SCHEMAS[0]).unwrap().0, changed);
    }

    #[test]
    fn applying_again_replaces_the_profile_instead_of_stacking_it() {
        let state = on_state();
        assert_eq!(base_for_on(&BASE.with(P), Some(&state), "default", false, &SCHEMAS[0]).unwrap(), (BASE, None));
    }

    #[test]
    fn notices_raw_accel_putting_your_values_back() {
        let (base, note) = base_for_on(&BASE, Some(&on_state()), "default", false, &SCHEMAS[0]).unwrap();
        assert_eq!(base, BASE);
        assert!(note.unwrap().contains("own values back"));
    }

    #[test]
    fn refuses_to_guess_after_an_outside_change_unless_told() {
        let edited = Fields { scale: 1100.0, ..BASE.with(P) };
        let error = base_for_on(&edited, Some(&on_state()), "default", false, &SCHEMAS[0]).unwrap_err();
        assert!(error.contains("--rebase") && error.contains("spraylab-direction off"));
        assert_eq!(base_for_on(&edited, Some(&on_state()), "default", true, &SCHEMAS[0]).unwrap().0, edited);
        assert!(base_for_on(&BASE, Some(&on_state()), "other", false, &SCHEMAS[0]).unwrap_err().contains("run spraylab-direction off first"));
    }

    #[test]
    fn off_puts_back_your_values() {
        let state = on_state();
        assert_eq!(off_values(&BASE.with(P), &state, &SCHEMAS[0]), (BASE, None));
        let (values, note) = off_values(&Fields { scale: 1100.0, ..BASE }, &state, &SCHEMAS[0]);
        assert_eq!(values, BASE);
        assert!(note.unwrap().contains("had changed"));
    }

    #[test]
    fn run_switches_only_while_raw_accel_has_its_values() {
        let switch = Switch { base: BASE, on: BASE.with(P), is_on: false };
        assert_eq!(switch.target(&BASE, true).unwrap(), BASE.with(P));
        assert!(switch.target(&BASE.with(P), true).is_err());
        let on = Switch { is_on: true, ..switch };
        assert_eq!(on.target(&BASE.with(P), false).unwrap(), BASE);
    }

    #[test]
    fn saves_and_loads() {
        let dir = std::env::temp_dir().join(format!("spraylab-direction-state-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(load(&dir).unwrap(), None);
        save(&dir, &on_state()).unwrap();
        assert_eq!(load(&dir).unwrap(), Some(on_state()));
        fs::write(dir.join(STATE_FILE), "{").unwrap();
        assert!(load(&dir).unwrap_err().contains("delete it"));
        fs::remove_dir_all(&dir).unwrap();
    }
}

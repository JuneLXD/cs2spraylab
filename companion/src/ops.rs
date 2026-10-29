//! Switching the profile on and off, shared by the window and the command line: read Raw Accel's settings.json and this
//! program's state, decide the values, write them, have writer.exe activate them, and say what happened in a `Report`.

use crate::profile::{self, ProfileFile};
use crate::rawaccel::{self, Fields, Schema, Settings, SETTINGS};
use crate::state::{self, State, INSTALLED_PROFILE};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// How much a line of a report matters: the command line prints every line, the window shows notes and results.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    /// The values and steps involved, and conditions the window shows by itself (a rotation caveat, Raw Accel's window).
    Detail,
    /// Something to know: a choice made, a warning, a file kept.
    Note,
    /// The outcome.
    Done,
}

/// What an operation did, line by line.
#[derive(Debug, Default)]
pub struct Report {
    pub lines: Vec<(Kind, String)>,
    /// Print each line as it comes (the command line), instead of only collecting it.
    pub echo: bool,
}

impl Report {
    pub fn printing() -> Report {
        Report { lines: Vec::new(), echo: true }
    }

    pub fn say(&mut self, kind: Kind, line: impl Into<String>) {
        let line = line.into();
        if self.echo {
            println!("{line}");
        }
        self.lines.push((kind, line));
    }

    /// The notes and results, for the window.
    pub fn summary(&self) -> Vec<&str> {
        self.lines.iter().filter(|(kind, _)| *kind != Kind::Detail).map(|(_, line)| line.as_str()).collect()
    }
}

/// Raw Accel's folder and its settings.json as read now.
pub struct Folder {
    pub path: PathBuf,
    pub settings_path: PathBuf,
    text: String,
    pub settings: Settings,
}

impl Folder {
    pub fn open(explicit: Option<&Path>) -> Result<Folder, String> {
        let path = rawaccel::find_folder(explicit)?;
        let settings_path = path.join(SETTINGS);
        let text = fs::read_to_string(&settings_path).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => format!("{} has no settings.json yet: open Raw Accel (rawaccel.exe) once so it writes one.", path.display()),
            _ => format!("Cannot read {}: {error}", settings_path.display()),
        })?;
        let settings = Settings::parse(&text)?;
        Ok(Folder { path, settings_path, text, settings })
    }

    /// Writes `fields` into profile `index`, has writer.exe activate them, then records `next`. If writer.exe fails,
    /// settings.json is put back as it was.
    fn commit(&mut self, index: usize, fields: &Fields, next: &State, report: &mut Report) -> Result<(), String> {
        self.settings.set(index, fields)?;
        let backup = rawaccel::backup_once(&self.settings_path).map_err(|error| format!("Cannot keep a copy of settings.json: {error}"))?;
        if let Some(backup) = backup {
            report.say(Kind::Note, format!("Kept a copy of your original settings.json as {}.", backup.display()));
        }
        let text = self.settings.text();
        rawaccel::replace_file(&self.settings_path, &text).map_err(|error| format!("Cannot write {}: {error}", self.settings_path.display()))?;
        report.say(Kind::Detail, "Activating with Raw Accel's writer.exe (the driver takes about a second)...");
        if let Err(error) = rawaccel::activate(&self.path, &self.settings_path) {
            let restored = rawaccel::replace_file(&self.settings_path, &self.text);
            self.settings = Settings::parse(&self.text)?;
            return Err(match restored {
                Ok(()) => format!("{error} settings.json is back as it was."),
                Err(write) => format!("{error} Putting settings.json back failed too ({write}): restore it from settings.json.spraylab-backup."),
            });
        }
        self.text = text;
        state::save(&self.path, next)
    }
}

/// The newest spraylab-direction-profile*.json in your Downloads folder.
pub fn newest_download() -> Result<PathBuf, String> {
    let folder = profile::downloads_folder().ok_or("Cannot find your Downloads folder: give the profile's path.")?;
    profile::newest_in(&folder).ok_or_else(|| {
        format!(
            "There is no spraylab-direction-profile*.json in {}. Download one from SprayLab (Pop > Direction Calibration > Download profile), or give its path.",
            folder.display()
        )
    })
}

fn same_file(a: &Path, b: &Path) -> bool {
    matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(a), Ok(b)) if a == b)
}

/// One line about a profile file, e.g. `Profile: ... (96 calibration flicks, made 2026-10-29, SprayLab strength 100%)`.
pub fn profile_line(source: &Path, file: &ProfileFile, strength: f64) -> String {
    let made = file.created.split('T').next().unwrap_or("");
    let here = if strength < 1.0 { format!(", {:.0}% of it applied here", strength * 100.0) } else { String::new() };
    format!("Profile: {} ({} calibration flicks, made {made}, SprayLab strength {:.0}%{here})", source.display(), file.flicks, file.strength * 100.0)
}

/// Adding a rotation on top of values that already scale directions unevenly is approximate; says by how much.
pub fn rotation_caveat(base: &Fields, rotation: f64) -> Option<String> {
    (rotation.abs() > 1e-9 && base.uneven()).then(|| {
        format!(
            "Your own Y/X, L/R or U/D are not 1, so the profile's rotation is added approximately (off by about {:.2}% of a movement).",
            rotation.to_radians().abs() * base.spread() * 100.0
        )
    })
}

/// A warning when Raw Accel's own window is open: pressing Apply there writes back the values it loaded.
fn raw_accel_window_warning() -> Option<&'static str> {
    #[cfg(windows)]
    if crate::win::running(&["rawaccel.exe"])[0] {
        return Some("Raw Accel's window is open: close it without pressing Apply, or it writes its old values back. Reopen it afterwards if you like.");
    }
    None
}

/// What switching on applies.
pub struct On<'a> {
    pub rawaccel: Option<&'a Path>,
    /// The Raw Accel profile to change; none for the first, which every mouse not assigned another uses.
    pub profile_name: Option<&'a str>,
    /// The profile file; none for the newest download.
    pub profile: Option<&'a Path>,
    /// How much of the profile (0 to 1); the file already includes SprayLab's strength slider.
    pub strength: f64,
    /// Take Raw Accel's current values as your own although they changed after the profile was applied.
    pub rebase: bool,
    pub dry_run: bool,
}

/// Writes the profile into Raw Accel on top of your own values and activates it.
pub fn turn_on(request: &On, report: &mut Report) -> Result<(), String> {
    let mut folder = Folder::open(request.rawaccel)?;
    let index = folder.settings.select(request.profile_name)?;
    let name = folder.settings.names()[index].clone();
    let schema = folder.settings.schema;
    let current = folder.settings.fields(index)?;
    let saved = state::load(&folder.path)?;
    let source = match request.profile {
        Some(path) => path.to_path_buf(),
        None => newest_download()?,
    };
    let file = profile::load(&source)?;
    let direction = file.direction.scaled(request.strength);
    let (base, note) = state::base_for_on(&current, saved.as_ref(), &name, request.rebase, schema)?;
    let on = base.with(direction);
    report.say(Kind::Detail, profile_line(&source, &file, request.strength));
    report.say(Kind::Detail, format!("  {}", direction.describe()));
    if direction.is_neutral() {
        report.say(Kind::Detail, "This profile changes nothing: SprayLab found no direction pattern worth correcting.");
    }
    if let Some(note) = note {
        report.say(Kind::Note, note);
    }
    report.say(Kind::Detail, format!("Raw Accel profile \"{name}\" (Raw Accel {} settings):", schema.version));
    report.say(Kind::Detail, format!("  your own values:   {}", base.describe(schema)));
    report.say(Kind::Detail, format!("  with the profile:  {}", on.describe(schema)));
    if let Some(caveat) = rotation_caveat(&base, direction.rotation) {
        report.say(Kind::Detail, caveat);
    }
    if request.dry_run {
        report.say(Kind::Done, "Dry run: nothing written.");
        return Ok(());
    }
    if let Some(warning) = raw_accel_window_warning() {
        report.say(Kind::Detail, warning);
    }
    let next = State::new(&name, base, Some(on), direction, &source.display().to_string(), file.flicks);
    folder.commit(index, &on, &next, report)?;
    let installed = folder.path.join(INSTALLED_PROFILE);
    if !same_file(&source, &installed) {
        fs::copy(&source, &installed).map_err(|error| format!("The profile is on, but copying it to {} failed: {error}", installed.display()))?;
    }
    report.say(Kind::Done, "The SprayLab profile is on, for every mouse Raw Accel handles in this profile, CS2 included.");
    Ok(())
}

/// Puts back your own values from before the profile and activates them.
pub fn turn_off(rawaccel: Option<&Path>, dry_run: bool, report: &mut Report) -> Result<(), String> {
    let mut folder = Folder::open(rawaccel)?;
    let schema = folder.settings.schema;
    let Some(saved) = state::load(&folder.path)? else {
        report.say(Kind::Done, "No SprayLab profile has been applied from this folder, so there is nothing to switch off.");
        return Ok(());
    };
    if saved.applied.is_none() {
        report.say(Kind::Done, format!("The SprayLab profile is already off; Raw Accel profile \"{}\" has your own values ({}).", saved.profile_name, saved.base.describe(schema)));
        return Ok(());
    }
    let index = folder.settings.select(Some(&saved.profile_name))?;
    let current = folder.settings.fields(index)?;
    let (values, note) = state::off_values(&current, &saved, schema);
    if let Some(note) = note {
        report.say(Kind::Note, note);
    }
    report.say(Kind::Detail, format!("Raw Accel profile \"{}\": putting back your own values, {}.", saved.profile_name, values.describe(schema)));
    if dry_run {
        report.say(Kind::Done, "Dry run: nothing written.");
        return Ok(());
    }
    if let Some(warning) = raw_accel_window_warning() {
        report.say(Kind::Detail, warning);
    }
    let next = State { applied: None, ..saved };
    folder.commit(index, &values, &next, report)?;
    report.say(Kind::Done, "The SprayLab profile is off.");
    Ok(())
}

/// Takes Raw Accel's current values as your own, with the profile counted as off, without writing anything: for when they
/// changed while the profile was on and have no profile in them (say Raw Accel was reset).
pub fn keep_current(rawaccel: Option<&Path>, report: &mut Report) -> Result<(), String> {
    let folder = Folder::open(rawaccel)?;
    let schema = folder.settings.schema;
    let Some(saved) = state::load(&folder.path)? else {
        report.say(Kind::Done, "No SprayLab profile has been applied from this folder, so Raw Accel's values are already your own.");
        return Ok(());
    };
    let index = folder.settings.select(Some(&saved.profile_name))?;
    let current = folder.settings.fields(index)?;
    let next = State { base: current, applied: None, ..saved };
    state::save(&folder.path, &next)?;
    report.say(Kind::Done, format!("Raw Accel's current values are now your own ({}), and the SprayLab profile is off. Switching it on puts it on top of them.", current.describe(schema)));
    Ok(())
}

/// Sends settings.json as it is to the driver again: Raw Accel's driver forgets its settings at every restart.
pub fn reapply(rawaccel: Option<&Path>, report: &mut Report) -> Result<(), String> {
    let folder = Folder::open(rawaccel)?;
    rawaccel::activate(&folder.path, &folder.settings_path)?;
    report.say(Kind::Done, "Raw Accel's driver has settings.json again, SprayLab profile included.");
    Ok(())
}

/// Whether the profile is on, as far as Raw Accel's settings.json shows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    /// Never applied, switched off, or Raw Accel has your own values back.
    Off,
    On,
    /// Raw Accel's values changed after the profile was applied: neither the profile's nor your own.
    Changed,
}

/// Raw Accel's folder, settings and this program's state as they are now, for the window.
#[derive(Clone, Debug)]
pub struct Inspection {
    pub folder: PathBuf,
    pub schema: &'static Schema,
    pub names: Vec<String>,
    /// The Raw Accel profile shown: the one the SprayLab profile is on in, else the one asked for, else the first.
    pub index: usize,
    pub current: Fields,
    pub saved: Option<State>,
    pub mode: Mode,
    /// When settings.json last changed, to notice changes made elsewhere.
    pub modified: Option<SystemTime>,
}

impl Inspection {
    pub fn name(&self) -> &str {
        &self.names[self.index]
    }

    /// Your own values: the ones from before the profile while it is applied, Raw Accel's current ones otherwise (as
    /// switching on takes them).
    pub fn base(&self) -> Fields {
        match &self.saved {
            Some(saved) if saved.applied.is_some() => saved.base,
            _ => self.current,
        }
    }
}

pub fn inspect(rawaccel: Option<&Path>, wanted: Option<&str>) -> Result<Inspection, String> {
    let folder = Folder::open(rawaccel)?;
    let saved = state::load(&folder.path)?;
    let index = match saved.as_ref().filter(|saved| saved.applied.is_some()) {
        Some(saved) => folder.settings.select(Some(&saved.profile_name)).map_err(|_| {
            format!(
                "The SprayLab profile is on in Raw Accel profile \"{}\", which settings.json no longer has. Rename it back, or delete {} to start over.",
                saved.profile_name,
                folder.path.join(state::STATE_FILE).display()
            )
        })?,
        None => folder.settings.select(wanted).unwrap_or(0),
    };
    let current = folder.settings.fields(index)?;
    let mode = match saved.as_ref().and_then(|saved| saved.applied.map(|applied| (saved, applied))) {
        Some((_, applied)) if current.close(&applied) => Mode::On,
        Some((saved, _)) if current.close(&saved.base) => Mode::Off,
        Some(_) => Mode::Changed,
        None => Mode::Off,
    };
    let modified = fs::metadata(&folder.settings_path).and_then(|meta| meta.modified()).ok();
    Ok(Inspection { names: folder.settings.names(), schema: folder.settings.schema, folder: folder.path, index, current, saved, mode, modified })
}

/// The command line's status.
pub fn status(rawaccel: Option<&Path>, profile_name: Option<&str>, report: &mut Report) -> Result<(), String> {
    let folder = Folder::open(rawaccel)?;
    let schema = folder.settings.schema;
    let saved = state::load(&folder.path)?;
    let wanted = profile_name.map(str::to_string).or_else(|| saved.as_ref().map(|state| state.profile_name.clone()));
    let index = folder.settings.select(wanted.as_deref())?;
    let current = folder.settings.fields(index)?;
    report.say(Kind::Detail, format!("Raw Accel folder: {} (Raw Accel {} settings)", folder.path.display(), schema.version));
    report.say(Kind::Detail, format!("Raw Accel profile \"{}\" in settings.json: {}", folder.settings.names()[index], current.describe(schema)));
    match &saved {
        None => report.say(Kind::Done, "No SprayLab profile has been applied from this folder."),
        Some(saved) => {
            report.say(Kind::Detail, format!("Your own values: {}", saved.base.describe(schema)));
            match saved.applied {
                Some(applied) if current.close(&applied) => {
                    report.say(Kind::Done, format!("SprayLab profile: ON, {}", saved.direction.describe()));
                    report.say(Kind::Detail, format!("  from {} ({} calibration flicks)", saved.source, saved.flicks));
                }
                Some(_) if current.close(&saved.base) => report.say(Kind::Done, "SprayLab profile: off (Raw Accel has your own values back)."),
                Some(_) => report.say(
                    Kind::Done,
                    format!(
                        "SprayLab profile: applied, but Raw Accel's values changed since; relative to your own they are now {}.",
                        current.relative_to(&saved.base).describe()
                    ),
                ),
                None => report.say(Kind::Done, format!("SprayLab profile: off. Last applied: {}", saved.direction.describe())),
            }
        }
    }
    report.say(Kind::Detail, "(Raw Accel's driver has these values once writer.exe or Raw Accel's window applied settings.json, as at every start.)");
    if let Some(newest) = profile::downloads_folder().and_then(|folder| profile::newest_in(&folder)) {
        report.say(Kind::Detail, format!("Newest downloaded profile: {}", newest.display()));
    }
    Ok(())
}

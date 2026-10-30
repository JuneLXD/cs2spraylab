//! What the window shows and does, without the window itself: the options, what Raw Accel's folder and the profile files
//! say, and the switching. `gui` puts it on screen; tests drive it on any system.

use crate::log::{self, Log};
use crate::ops::{self, Inspection, Mode, Report};
use crate::options::{self, Options};
use crate::profile::{self, Direction, ProfileFile};
use crate::rawaccel::{self, Fields, Schema, WRITER};
use crate::state::INSTALLED_PROFILE;
use std::path::{Path, PathBuf};

/// The hotkeys the window offers, as `hotkey::parse` reads them; empty for none.
pub const HOTKEYS: [&str; 9] = ["ctrl+alt+p", "ctrl+alt+d", "ctrl+shift+f9", "f8", "f9", "f10", "pause", "scrolllock", ""];

/// The main card: what it shows. The numbers match `phase` in ui/app.slint.
pub const SETUP: i32 = 0;
pub const OFF: i32 = 1;
pub const ON: i32 = 2;
pub const CHANGED: i32 = 3;
pub const WORKING: i32 = 4;

/// The status pill's colour, matching `tone` in ui/app.slint.
pub const GREY: i32 = 0;
pub const GREEN: i32 = 1;
pub const AMBER: i32 = 2;
pub const RED: i32 = 3;

/// `ctrl+alt+p` as `Ctrl+Alt+P`.
pub fn hotkey_label(name: &str) -> String {
    if name.is_empty() {
        return "None".into();
    }
    name.split('+')
        .map(|part| match part {
            "ctrl" | "control" => "Ctrl".to_string(),
            "alt" => "Alt".into(),
            "shift" => "Shift".into(),
            "win" => "Win".into(),
            "pause" => "Pause".into(),
            "scrolllock" => "Scroll Lock".into(),
            "pageup" => "Page Up".into(),
            "pagedown" => "Page Down".into(),
            "end" => "End".into(),
            "home" => "Home".into(),
            "insert" => "Insert".into(),
            key if key.starts_with("numpad") => format!("Num {}", &key[6..]),
            key => key.to_uppercase(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// A multiplier as a signed percentage: 1.0341 is `+3.4%`.
pub fn percent(gain: f64) -> String {
    let change = (gain - 1.0) * 100.0;
    if change.abs() < 0.05 {
        return "0%".into();
    }
    format!("{}{:.1}%", if change > 0.0 { "+" } else { "\u{2212}" }, change.abs())
}

/// A rotation such as `+1.25°`.
pub fn degrees(rotation: f64) -> String {
    if rotation.abs() < 0.005 {
        return "0°".into();
    }
    format!("{}{:.2}°", if rotation > 0.0 { "+" } else { "\u{2212}" }, rotation.abs())
}

fn number(value: f64, places: usize) -> String {
    let text = format!("{value:.places$}");
    if text.contains('.') {
        text.trim_end_matches('0').trim_end_matches('.').to_string()
    } else {
        text
    }
}

/// Raw Accel's five values for the window's table: yours beside `other` (with the profile, or as Raw Accel has them now).
pub fn rows(yours: &Fields, other: Option<&Fields>, schema: &Schema) -> Vec<Row> {
    let scale = if schema.version == "1.6" { "Sensitivity" } else { "Output DPI" };
    let cells = |f: &Fields| [number(f.scale, 2), number(f.yx, 4), number(f.lr, 4), number(f.ud, 4), format!("{}°", number(f.rotation, 2))];
    let mine = cells(yours);
    let theirs = other.map(cells);
    [scale, "Y/X ratio", "L/R ratio", "U/D ratio", "Rotation"]
        .iter()
        .enumerate()
        .map(|(i, name)| {
            let other = theirs.as_ref().map_or_else(|| "\u{2014}".to_string(), |cells| cells[i].clone());
            Row { name: name.to_string(), changed: theirs.is_some() && other != mine[i], yours: mine[i].clone(), other }
        })
        .collect()
}

/// 1 when a multiplier makes that direction more sensitive, -1 less, 0 when `percent` shows no change.
fn sign(gain: f64) -> i32 {
    let change = (gain - 1.0) * 100.0;
    if change.abs() < 0.05 {
        0
    } else {
        change.signum() as i32
    }
}

fn made(file: &ProfileFile) -> &str {
    file.created.split('T').next().unwrap_or("")
}

fn same_direction(a: &Direction, b: &Direction) -> bool {
    [(a.rotation, b.rotation), (a.right, b.right), (a.left, b.left), (a.up, b.up), (a.down, b.down)].iter().all(|(x, y)| (x - y).abs() < 1e-6)
}

/// Where the window keeps its files and looks for downloads; tests point these at temporary folders.
#[derive(Clone, Debug)]
pub struct Env {
    /// The folder for options.json and log.txt.
    pub home: PathBuf,
    /// Where SprayLab's profile downloads land; none when unknown.
    pub downloads: Option<PathBuf>,
}

impl Env {
    pub fn system() -> Option<Env> {
        Some(Env { home: options::home()?, downloads: profile::downloads_folder() })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Job {
    On,
    Off,
    /// Keep Raw Accel's current values as your own.
    Keep,
    /// Send settings.json to the driver again.
    Reapply,
}

/// What asked for a job: the hotkey beeps, the rest show in the window and tray.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Source {
    Window,
    Tray,
    Hotkey,
    Cs2,
    Start,
}

/// A job with everything it needs, to run away from the window's thread (writer.exe takes about a second).
#[derive(Clone, Debug)]
pub struct Work {
    pub job: Job,
    folder: PathBuf,
    profile_name: String,
    profile: Option<PathBuf>,
    strength: f64,
}

impl Work {
    pub fn run(&self) -> (Report, Result<(), String>) {
        let mut report = Report::default();
        let folder = Some(self.folder.as_path());
        let result = match self.job {
            Job::On => ops::turn_on(
                &ops::On { rawaccel: folder, profile_name: Some(&self.profile_name), profile: self.profile.as_deref(), strength: self.strength, rebase: false, dry_run: false },
                &mut report,
            ),
            Job::Off => ops::turn_off(folder, false, &mut report),
            Job::Keep => ops::keep_current(folder, &mut report),
            Job::Reapply => ops::reapply(folder, &mut report),
        };
        (report, result)
    }
}

/// A profile file found or chosen.
#[derive(Clone, Debug)]
pub struct Found {
    pub path: PathBuf,
    pub file: ProfileFile,
}

impl Found {
    fn name(&self) -> String {
        self.path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
    }
}

/// A line of the Raw Accel values table: a value as yours, and with the profile (or as Raw Accel has it now).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Row {
    pub name: String,
    pub yours: String,
    pub other: String,
    pub changed: bool,
}

/// Everything the window shows, as plain values.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct View {
    pub phase: i32,
    pub tone: i32,
    /// The status card's big word: ON, OFF, SWITCHING, SET UP or CHECK RAW ACCEL.
    pub state: String,
    /// A label beside it, such as WAITING FOR CS2, and its colour.
    pub tag: String,
    pub tag_tone: i32,
    pub action: String,
    pub action_enabled: bool,
    pub summary: String,
    /// The hotkey line under the summary.
    pub hint: String,
    /// While on: the chosen profile or strength differ from what Raw Accel has.
    pub update: bool,
    pub can_locate: bool,
    pub has_profile: bool,
    pub profile_name: String,
    pub profile_detail: String,
    /// The profile panel's tag, such as 96 FLICKS.
    pub flicks: String,
    /// Right, left, up, down and rotation after the strength, and whether each makes that way more (1) or less (-1)
    /// sensitive, or turns it (rotation).
    pub gains: [String; 5],
    pub signs: [i32; 5],
    pub newer: String,
    pub raw_folder: String,
    pub raw_version: String,
    pub raw_rows: Vec<Row>,
    /// The second column's heading: WITH PROFILE, or NOW while the profile is applied.
    pub raw_other: String,
    pub raw_profiles: Vec<String>,
    pub raw_profile: i32,
    pub raw_profile_enabled: bool,
    pub hotkeys: Vec<String>,
    pub hotkey: i32,
    pub strength: f32,
    pub cs2_only: bool,
    pub beep: bool,
    pub warning: String,
    pub message: String,
    pub error: bool,
    pub tooltip: String,
    pub is_on: bool,
}

pub struct Controller {
    pub env: Env,
    pub options: Options,
    pub log: Log,
    pub raw: Result<Inspection, String>,
    /// The profile switching on applies, an error when that file cannot be used, or none found.
    pub profile: Result<Option<Found>, String>,
    /// A download newer than that profile.
    pub newer: Option<Found>,
    pub busy: Option<(Job, Source)>,
    /// The last result, and whether it is an error.
    pub message: Option<(String, bool)>,
    /// Whether CS2 was running at the last look, while "on only while CS2 runs" is set.
    pub cs2_seen: Option<bool>,
    /// Raw Accel's own window is open.
    pub raw_accel_window: bool,
    pub hotkey_problem: Option<String>,
}

impl Controller {
    pub fn new(env: Env) -> Controller {
        let (options, problem) = options::load(&env.home.join(options::FILE));
        let log = Log::new(env.home.join(log::FILE));
        let mut controller = Controller {
            env,
            options,
            log,
            raw: Err(String::new()),
            profile: Ok(None),
            newer: None,
            busy: None,
            message: problem.map(|problem| (problem, true)),
            cs2_seen: None,
            raw_accel_window: false,
            hotkey_problem: None,
        };
        controller.refresh(true);
        controller
    }

    fn save(&mut self) {
        if let Err(error) = options::save(&self.env.home.join(options::FILE), &self.options) {
            self.message = Some((error, true));
        }
    }

    /// Reads Raw Accel's folder again, and when `files` also looks for profile files.
    pub fn refresh(&mut self, files: bool) {
        let before = self.raw.as_ref().ok().map(|raw| raw.mode);
        self.raw = ops::inspect(self.options.raw_accel.as_deref(), self.options.raw_accel_profile.as_deref());
        // The last job's message describes a state that something else (Raw Accel's window, say) has since changed.
        if before.is_some() && before != self.raw.as_ref().ok().map(|raw| raw.mode) {
            self.message = None;
        }
        if files {
            self.find_profiles();
        }
    }

    /// The profile to apply: the one chosen, else the copy of the one last applied, else the newest download.
    fn find_profiles(&mut self) {
        let installed = self.raw.as_ref().ok().map(|raw| raw.folder.join(INSTALLED_PROFILE)).filter(|path| path.is_file());
        let newest = self.env.downloads.as_deref().and_then(profile::newest_in);
        let chosen = self.options.profile.clone().filter(|path| path.is_file());
        self.profile = match chosen.or(installed).or_else(|| newest.clone()) {
            None => Ok(None),
            Some(path) => profile::load(&path).map(|file| Some(Found { path, file })),
        };
        self.newer = newest.and_then(|path| {
            let file = profile::load(&path).ok()?;
            match &self.profile {
                Ok(Some(current)) if current.path == path || current.file.created >= file.created => None,
                Ok(None) => None,
                _ => Some(Found { path, file }),
            }
        });
    }

    pub fn is_on(&self) -> bool {
        matches!(&self.raw, Ok(raw) if raw.mode == Mode::On)
    }

    fn found(&self) -> Option<&Found> {
        self.profile.as_ref().ok()?.as_ref()
    }

    /// The direction switching on applies now.
    pub fn wanted(&self) -> Option<Direction> {
        self.found().map(|found| found.file.direction.scaled(self.options.strength))
    }

    /// While on: whether the chosen profile or strength differ from what Raw Accel has.
    pub fn outdated(&self) -> bool {
        let (Ok(raw), Some(wanted)) = (&self.raw, self.wanted()) else { return false };
        raw.mode == Mode::On && raw.saved.as_ref().is_some_and(|saved| !same_direction(&saved.direction, &wanted))
    }

    /// Starts `job` unless another runs or it cannot run now, and hands back the work for a worker thread.
    pub fn begin(&mut self, job: Job, source: Source) -> Option<Work> {
        if self.busy.is_some() {
            return None;
        }
        let raw = self.raw.as_ref().ok()?;
        let profile = match job {
            Job::On if raw.mode == Mode::Changed => return None,
            Job::On => Some(self.found()?.path.clone()),
            _ => None,
        };
        let work = Work { job, folder: raw.folder.clone(), profile_name: raw.name().to_string(), profile, strength: self.options.strength };
        self.busy = Some((job, source));
        self.log.write(&format!("{job:?} ({source:?})"));
        Some(work)
    }

    /// On if off, off if on.
    pub fn toggle(&mut self, source: Source) -> Option<Work> {
        self.begin(if self.is_on() { Job::Off } else { Job::On }, source)
    }

    /// Records a finished job's result and looks at Raw Accel again. Returns the job that finished.
    pub fn finish(&mut self, report: Report, result: Result<(), String>) -> Option<(Job, Source)> {
        let done = self.busy.take();
        self.refresh(true);
        for (_, line) in &report.lines {
            self.log.write(line);
        }
        let mut lines: Vec<String> = report.summary().into_iter().map(str::to_string).collect();
        if let Err(error) = &result {
            self.log.write(&format!("Error: {error}"));
            lines.push(error.clone());
        }
        self.message = Some((lines.join("\n"), result.is_err()));
        done
    }

    /// CS2 was seen running or not: the switch to make, when "on only while CS2 runs" is set and it started or closed.
    pub fn cs2(&mut self, running: bool) -> Option<Work> {
        if !self.options.cs2_only {
            self.cs2_seen = None;
            return None;
        }
        if self.busy.is_some() || self.cs2_seen == Some(running) {
            return None;
        }
        self.cs2_seen = Some(running);
        if running == self.is_on() {
            return None;
        }
        self.log.write(if running { "CS2 is running" } else { "CS2 is not running" });
        self.begin(if running { Job::On } else { Job::Off }, Source::Cs2)
    }

    pub fn set_strength(&mut self, percent: f64) {
        self.options.strength = (percent / 100.0).clamp(0.0, 1.0);
        self.save();
    }

    pub fn hotkeys(&self) -> (Vec<String>, usize) {
        let mut names: Vec<String> = HOTKEYS.iter().map(|name| name.to_string()).collect();
        let index = names.iter().position(|name| *name == self.options.hotkey).unwrap_or_else(|| {
            names.insert(names.len() - 1, self.options.hotkey.clone());
            names.len() - 2
        });
        (names, index)
    }

    pub fn set_hotkey(&mut self, name: &str) {
        self.options.hotkey = name.to_string();
        self.save();
    }

    pub fn set_cs2_only(&mut self, on: bool) {
        self.options.cs2_only = on;
        self.cs2_seen = None;
        self.save();
    }

    pub fn set_beep(&mut self, on: bool) {
        self.options.beep = on;
        self.save();
    }

    pub fn set_raw_accel_profile(&mut self, index: usize) {
        let Ok(raw) = &self.raw else { return };
        let Some(name) = raw.names.get(index).cloned() else { return };
        self.options.raw_accel_profile = Some(name);
        self.save();
        self.refresh(false);
    }

    /// Uses the Raw Accel folder holding `path` (writer.exe, or the folder itself).
    pub fn set_raw_accel(&mut self, path: &Path) {
        let folder = if path.is_dir() { path.to_path_buf() } else { path.parent().map(Path::to_path_buf).unwrap_or_default() };
        match rawaccel::find_folder(Some(&folder)) {
            Ok(folder) => {
                self.log.write(&format!("Raw Accel folder: {}", folder.display()));
                self.options.raw_accel = Some(folder);
                self.save();
                self.message = None;
                self.refresh(true);
            }
            Err(error) => self.message = Some((error, true)),
        }
    }

    pub fn choose_profile(&mut self, path: PathBuf) {
        match profile::load(&path) {
            Ok(_) => {
                self.options.profile = Some(path);
                self.save();
                self.message = None;
                self.find_profiles();
            }
            Err(error) => self.message = Some((error, true)),
        }
    }

    pub fn use_newer(&mut self) {
        if let Some(newer) = self.newer.take() {
            self.choose_profile(newer.path);
        }
    }

    pub fn view(&self) -> View {
        let mut view = View {
            strength: (self.options.strength * 100.0) as f32,
            cs2_only: self.options.cs2_only,
            beep: self.options.beep,
            is_on: self.is_on(),
            ..View::default()
        };
        let (hotkeys, hotkey) = self.hotkeys();
        view.hotkeys = hotkeys.iter().map(|name| hotkey_label(name)).collect();
        view.hotkey = hotkey as i32;
        let hotkey_name = (!self.options.hotkey.is_empty()).then(|| hotkey_label(&self.options.hotkey));
        let wanted = self.wanted();

        match self.found() {
            Some(found) => {
                view.has_profile = true;
                view.profile_name = found.name();
                let installed = self.raw.as_ref().is_ok_and(|raw| found.path == raw.folder.join(INSTALLED_PROFILE));
                // SprayLab's own strength slider is worth a mention only when it was not at 100%.
                let spraylab_strength = if found.file.strength < 1.0 { format!(" · SprayLab strength {:.0}%", found.file.strength * 100.0) } else { String::new() };
                view.profile_detail = format!("Made {}{spraylab_strength}{}", made(&found.file), if installed { " · last applied" } else { "" });
                view.flicks = format!("{} FLICKS", found.file.flicks);
                let p = wanted.expect("a profile was found");
                view.gains = [percent(p.right), percent(p.left), percent(p.up), percent(p.down), degrees(p.rotation)];
                let turn = if p.rotation.abs() < 0.005 { 0 } else { p.rotation.signum() as i32 };
                view.signs = [sign(p.right), sign(p.left), sign(p.up), sign(p.down), turn];
            }
            None => {
                view.profile_name = "No profile yet".into();
                view.profile_detail = match &self.profile {
                    Err(error) => error.clone(),
                    Ok(_) => "Download one in SprayLab: Aim › Direction calibration.".into(),
                };
                view.gains = std::array::from_fn(|_| "\u{2014}".to_string());
            }
        }
        if let Some(newer) = &self.newer {
            view.newer = format!("A newer profile is in Downloads: made {}, {} flicks.", made(&newer.file), newer.file.flicks);
        }

        let mut warnings = Vec::new();
        match &self.raw {
            Ok(raw) => {
                let base = raw.base();
                view.raw_folder = raw.folder.display().to_string();
                view.raw_version = format!("V{}", raw.schema.version);
                view.raw_profiles = raw.names.clone();
                view.raw_profile = raw.index as i32;
                view.raw_profile_enabled = raw.mode == Mode::Off && self.busy.is_none() && raw.saved.as_ref().is_none_or(|saved| saved.applied.is_none());
                let (other, heading) = match raw.mode {
                    Mode::On | Mode::Changed => (Some(raw.current), "NOW"),
                    Mode::Off => (wanted.map(|wanted| base.with(wanted)), "WITH PROFILE"),
                };
                view.raw_rows = rows(&base, other.as_ref(), raw.schema);
                view.raw_other = heading.into();
                if let Some(caveat) = wanted.and_then(|wanted| ops::rotation_caveat(&base, wanted.rotation)) {
                    warnings.push(caveat);
                }
                if self.raw_accel_window {
                    warnings.push("Raw Accel's window is open. Close it without pressing Apply there: Apply writes back the values it loaded.".into());
                }
            }
            Err(error) if error.starts_with("Cannot find Raw Accel") => view.raw_folder = "Not found".into(),
            Err(_) => view.raw_folder = "Cannot use its settings".into(),
        }
        if wanted.is_some_and(|wanted| wanted.is_neutral()) {
            warnings.push("This profile changes nothing: SprayLab found no direction pattern worth correcting.".into());
        }
        if let Some(problem) = &self.hotkey_problem {
            warnings.push(problem.clone());
        }
        view.warning = warnings.join("\n");

        let mode = self.raw.as_ref().ok().map(|raw| raw.mode);
        let hint = hotkey_name.as_ref().map(|name| format!("{name} switches it from anywhere, in game too.")).unwrap_or_default();
        if let Some((job, _)) = self.busy {
            view.phase = WORKING;
            view.state = "SWITCHING".into();
            view.tone = AMBER;
            view.action = match job {
                Job::On => "SWITCHING ON…",
                Job::Off => "SWITCHING OFF…",
                Job::Keep => "SAVING…",
                Job::Reapply => "ACTIVATING…",
            }
            .into();
            view.summary = "Raw Accel's writer.exe is activating the settings, which takes about a second. If it shows a message, read it and close it.".into();
        } else if mode == Some(Mode::Changed) {
            view.phase = CHANGED;
            view.state = "CHECK RAW ACCEL".into();
            view.tone = RED;
            view.summary = "Raw Accel's values changed while the profile was on, for example from Apply in Raw Accel's window. Restore puts back \
                            your own values and switches the profile off. Keep the current ones only if they have no profile in them."
                .into();
        } else if mode == Some(Mode::On) {
            view.phase = ON;
            view.state = "ON".into();
            view.tag = if self.options.cs2_only { "CS2 RUNNING" } else { "" }.into();
            view.tone = GREEN;
            view.action = "TURN OFF".into();
            view.action_enabled = true;
            view.update = self.outdated();
            if view.update {
                view.tag = "CHANGES NOT APPLIED".into();
            }
            view.summary = format!(
                "CS2 and every other program get the profile now. In SprayLab, keep Apply profile and Record calibration flicks \
                 off while it is on.{}",
                if self.options.cs2_only { " It goes off by itself when CS2 closes." } else { "" }
            );
            view.hint = hint;
        } else if mode.is_none() || self.found().is_none() {
            view.phase = SETUP;
            view.state = "SET UP".into();
            view.tone = AMBER;
            view.can_locate = mode.is_none();
            view.summary = match &self.raw {
                Err(error) if error.starts_with("Cannot find Raw Accel") => format!(
                    "SprayLab Direction works through Raw Accel, the signed mouse driver, and cannot find it. Install Raw Accel \
                     (installer.exe, then restart Windows), open rawaccel.exe once, then put this program in its folder or locate {WRITER}."
                ),
                Err(error) => error.clone(),
                Ok(_) => match &self.profile {
                    Err(error) => format!("{error} Choose another file, or download the profile again."),
                    Ok(_) => "No profile yet. In SprayLab, with no direction profile on anywhere, play any mode with Record calibration \
                              flicks on, then press Download profile in Aim › Direction calibration. It shows up here by itself."
                        .into(),
                },
            };
        } else {
            view.phase = OFF;
            view.state = "OFF".into();
            view.tag = if self.options.cs2_only { "WAITING FOR CS2" } else { "" }.into();
            view.tone = GREY;
            view.action = "TURN ON".into();
            view.action_enabled = true;
            view.summary = format!(
                "Your own Raw Accel settings are in use. Turning it on writes the profile on top of them and activates it.{}",
                if self.options.cs2_only { " It goes on by itself when CS2 starts, and off when CS2 closes." } else { "" }
            );
            view.hint = hint;
        }
        view.tag_tone = if view.update { AMBER } else { view.tone };
        if let Some((message, error)) = &self.message {
            view.message = message.clone();
            view.error = *error;
        }
        let state = match view.phase {
            ON => "on",
            OFF if self.options.cs2_only => "off, waiting for CS2",
            OFF => "off",
            WORKING => "switching",
            CHANGED => "check Raw Accel",
            _ => "set up needed",
        };
        view.tooltip = format!("SprayLab Direction: {state}{}", hotkey_name.map(|name| format!("\n{name} switches it")).unwrap_or_default());
        view
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_hotkeys_and_numbers_for_the_window() {
        assert_eq!(hotkey_label("ctrl+alt+p"), "Ctrl+Alt+P");
        assert_eq!(hotkey_label("scrolllock"), "Scroll Lock");
        assert_eq!(hotkey_label("shift+numpad5"), "Shift+Num 5");
        assert_eq!(hotkey_label(""), "None");
        for name in HOTKEYS.iter().filter(|name| !name.is_empty()) {
            assert!(crate::hotkey::parse(name).is_ok(), "{name}");
        }
        assert_eq!(percent(1.0341), "+3.4%");
        assert_eq!(percent(0.9671), "\u{2212}3.3%");
        assert_eq!(percent(1.0002), "0%");
        assert_eq!(degrees(1.25), "+1.25°");
        assert_eq!(degrees(-0.5), "\u{2212}0.50°");
        assert_eq!((sign(1.0341), sign(0.9671), sign(1.0002)), (1, -1, 0));
        let schema = &rawaccel::SCHEMAS[0];
        let base = Fields { scale: 1000.0, yx: 1.0, lr: 1.0, ud: 1.0, rotation: 0.0 };
        let on = Fields { scale: 1034.1, yx: 0.968_475, lr: 1.0, ud: 1.081_977, rotation: 1.25 };
        let table = rows(&base, Some(&on), schema);
        let line = |i: usize| (table[i].name.as_str(), table[i].yours.as_str(), table[i].other.as_str(), table[i].changed);
        assert_eq!(line(0), ("Output DPI", "1000", "1034.1", true));
        assert_eq!(line(1), ("Y/X ratio", "1", "0.9685", true));
        assert_eq!(line(2), ("L/R ratio", "1", "1", false));
        assert_eq!(line(4), ("Rotation", "0°", "1.25°", true));
        assert!(rows(&base, None, schema).iter().all(|row| row.other == "\u{2014}" && !row.changed));
        assert_eq!(rows(&base, None, &rawaccel::SCHEMAS[1])[0].name, "Sensitivity");
    }

    #[test]
    fn keeps_a_hotkey_set_elsewhere_in_the_list() {
        let dir = std::env::temp_dir().join(format!("spraylab-direction-app-{}", std::process::id()));
        let mut controller = Controller::new(Env { home: dir.clone(), downloads: None });
        assert_eq!(controller.hotkeys().1, 0);
        controller.set_hotkey("ctrl+shift+k");
        let (names, index) = controller.hotkeys();
        assert_eq!((names[index].as_str(), names.last().unwrap().as_str()), ("ctrl+shift+k", ""));
        controller.set_hotkey("");
        assert_eq!(controller.hotkeys().1, HOTKEYS.len() - 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

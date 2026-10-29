//! The spraylab-direction command line: apply, off, status, run and startup.

use spraylab_direction::hotkey;
use spraylab_direction::profile::{self, ProfileFile};
use spraylab_direction::rawaccel::{self, Fields, Settings, SETTINGS};
use spraylab_direction::state::{self, State, INSTALLED_PROFILE};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str = "\
SprayLab Direction applies a SprayLab Direction Calibration profile to all mouse input through Raw Accel.

Usage:
  spraylab-direction apply [PROFILE]   write the profile into Raw Accel's settings and activate it
  spraylab-direction off               put your own values back and activate them
  spraylab-direction status            show your values, the profile and what Raw Accel's settings have now
  spraylab-direction run [PROFILE]     stay open: a hotkey switches the profile on and off, and with --cs2
                                       it is on only while CS2 runs
  spraylab-direction startup on|off    start `run` with the options given when you sign in to Windows, or stop

PROFILE is the file SprayLab downloads (Pop > Direction Calibration > Download profile). Without it, apply takes the
newest spraylab-direction-profile*.json in your Downloads folder, and run the profile last applied.

Options:
  --rawaccel FOLDER    Raw Accel's folder, with writer.exe and settings.json (default: this program's folder)
  --profile-name NAME  the Raw Accel profile to change (default: the first, used by every mouse not assigned another)
  --strength S         apply S (0 to 1) of the profile; the file already includes SprayLab's strength slider
  --rebase             take Raw Accel's current values as your own although they changed after the profile was applied
  --dry-run            show what would change and write nothing
  --hotkey KEYS        run: the on/off hotkey (default ctrl+alt+p), such as f8 or ctrl+shift+d
  --cs2                run: on while cs2.exe runs and off otherwise; the hotkey still switches it
  --quiet              run: no beeps

Switch the profile off before calibrating in SprayLab again: SprayLab sees what Raw Accel outputs, so it would measure
on top of the profile. While the profile is on, leave Apply profile in SprayLab off, or SprayLab applies it twice.
";

#[derive(Default)]
struct Options {
    command: String,
    profile: Option<PathBuf>,
    startup: Option<String>,
    rawaccel: Option<PathBuf>,
    profile_name: Option<String>,
    strength: Option<f64>,
    rebase: bool,
    dry_run: bool,
    hotkey: Option<String>,
    cs2: bool,
    quiet: bool,
}

fn parse(args: &[String]) -> Result<Options, String> {
    let mut options = Options::default();
    let mut positional = Vec::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        let mut value = |name: &str| iter.next().cloned().ok_or_else(|| format!("{name} needs a value."));
        match arg.as_str() {
            "--rawaccel" => options.rawaccel = Some(PathBuf::from(value(arg)?)),
            "--profile-name" => options.profile_name = Some(value(arg)?),
            "--strength" => {
                let text = value(arg)?;
                let strength = text.parse::<f64>().ok().filter(|s| (0.0..=1.0).contains(s));
                options.strength = Some(strength.ok_or_else(|| format!("--strength takes a number from 0 to 1, not \"{text}\"."))?);
            }
            "--hotkey" => options.hotkey = Some(value(arg)?),
            "--rebase" => options.rebase = true,
            "--dry-run" => options.dry_run = true,
            "--cs2" => options.cs2 = true,
            "--quiet" => options.quiet = true,
            "-h" | "--help" => positional.insert(0, "help".to_string()),
            "--version" => positional.insert(0, "version".to_string()),
            flag if flag.starts_with("--") => return Err(format!("Unknown option {flag}. Run spraylab-direction help.")),
            _ => positional.push(arg.clone()),
        }
    }
    let mut positional = positional.into_iter();
    options.command = positional.next().unwrap_or_default();
    match options.command.as_str() {
        "apply" | "run" => options.profile = positional.next().map(PathBuf::from),
        "startup" => options.startup = positional.next(),
        _ => {}
    }
    if let Some(extra) = positional.next() {
        return Err(format!("Unexpected \"{extra}\". Run spraylab-direction help."));
    }
    Ok(options)
}

/// Raw Accel's folder and its settings.json as read now.
struct Folder {
    path: PathBuf,
    settings_path: PathBuf,
    text: String,
    settings: Settings,
}

impl Folder {
    fn open(options: &Options) -> Result<Folder, String> {
        let path = rawaccel::find_folder(options.rawaccel.as_deref())?;
        let settings_path = path.join(SETTINGS);
        let text = fs::read_to_string(&settings_path).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => format!("{} has no settings.json yet: open Raw Accel (rawaccel.exe) once so it writes one.", path.display()),
            _ => format!("Cannot read {}: {error}", settings_path.display()),
        })?;
        let settings = Settings::parse(&text)?;
        Ok(Folder { path, settings_path, text, settings })
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    fn reread(&mut self) -> Result<(), String> {
        let text = fs::read_to_string(&self.settings_path).map_err(|error| format!("Cannot read {}: {error}", self.settings_path.display()))?;
        self.settings = Settings::parse(&text)?;
        self.text = text;
        Ok(())
    }

    /// Writes `fields` into profile `index`, has writer.exe activate them, then records `next`. If writer.exe fails,
    /// settings.json is put back as it was.
    fn commit(&mut self, index: usize, fields: &Fields, next: &State) -> Result<(), String> {
        self.settings.set(index, fields)?;
        let backup = rawaccel::backup_once(&self.settings_path).map_err(|error| format!("Cannot keep a copy of settings.json: {error}"))?;
        if let Some(backup) = backup {
            println!("Kept a copy of your original settings.json as {}.", backup.display());
        }
        let text = self.settings.text();
        rawaccel::replace_file(&self.settings_path, &text).map_err(|error| format!("Cannot write {}: {error}", self.settings_path.display()))?;
        println!("Activating with Raw Accel's writer.exe (the driver takes about a second)...");
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

fn newest_download() -> Result<PathBuf, String> {
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

fn show_profile(source: &Path, file: &ProfileFile, strength: Option<f64>) {
    let made = file.created.split('T').next().unwrap_or("");
    let here = strength.map(|s| format!(", {:.0}% of it applied here", s * 100.0)).unwrap_or_default();
    println!("Profile: {} ({} calibration flicks, made {made}, SprayLab strength {:.0}%{here})", source.display(), file.flicks, file.strength * 100.0);
}

/// Adding a rotation on top of values that already scale directions unevenly is approximate; says by how much.
fn show_rotation_caveat(base: &Fields, rotation: f64) {
    if rotation.abs() > 1e-9 && base.uneven() {
        println!(
            "Your own Y/X, L/R or U/D are not 1, so the profile's rotation is added approximately (off by about {:.2}% of a movement).",
            rotation.to_radians().abs() * base.spread() * 100.0
        );
    }
}

fn warn_if_raw_accel_window_open() {
    #[cfg(windows)]
    if spraylab_direction::win::running("rawaccel.exe") {
        println!("Raw Accel's window is open: close it without pressing Apply, or it writes its old values back. Reopen it afterwards if you like.");
    }
}

fn apply(options: &Options) -> Result<(), String> {
    let mut folder = Folder::open(options)?;
    let index = folder.settings.select(options.profile_name.as_deref())?;
    let name = folder.settings.names()[index].clone();
    let schema = folder.settings.schema;
    let current = folder.settings.fields(index)?;
    let saved = state::load(&folder.path)?;
    let source = match &options.profile {
        Some(path) => path.clone(),
        None => newest_download()?,
    };
    let file = profile::load(&source)?;
    let direction = file.direction.scaled(options.strength.unwrap_or(1.0));
    let (base, note) = state::base_for_on(&current, saved.as_ref(), &name, options.rebase, schema)?;
    let on = base.with(direction);
    show_profile(&source, &file, options.strength);
    println!("  {}", direction.describe());
    if direction.is_neutral() {
        println!("  This profile changes nothing: SprayLab found no direction pattern worth correcting.");
    }
    if let Some(note) = note {
        println!("{note}");
    }
    println!("Raw Accel profile \"{name}\" (Raw Accel {} settings):", schema.version);
    println!("  your own values:   {}", base.describe(schema));
    println!("  with the profile:  {}", on.describe(schema));
    show_rotation_caveat(&base, direction.rotation);
    if options.dry_run {
        println!("Dry run: nothing written.");
        return Ok(());
    }
    warn_if_raw_accel_window_open();
    let next = State::new(&name, base, Some(on), direction, &source.display().to_string(), file.flicks);
    folder.commit(index, &on, &next)?;
    let installed = folder.path.join(INSTALLED_PROFILE);
    if !same_file(&source, &installed) {
        fs::copy(&source, &installed).map_err(|error| format!("The profile is on, but copying it to {} failed: {error}", installed.display()))?;
    }
    println!("The SprayLab profile is on, for every mouse Raw Accel handles in this profile, CS2 included.");
    println!("Run spraylab-direction off before calibrating in SprayLab again, and leave Apply profile in SprayLab off meanwhile.");
    Ok(())
}

fn off(options: &Options) -> Result<(), String> {
    let mut folder = Folder::open(options)?;
    let schema = folder.settings.schema;
    let Some(saved) = state::load(&folder.path)? else {
        println!("No SprayLab profile has been applied from this folder, so there is nothing to switch off.");
        return Ok(());
    };
    if saved.applied.is_none() {
        println!("The SprayLab profile is already off; Raw Accel profile \"{}\" has your own values ({}).", saved.profile_name, saved.base.describe(schema));
        return Ok(());
    }
    let index = folder.settings.select(Some(&saved.profile_name))?;
    let current = folder.settings.fields(index)?;
    let (values, note) = state::off_values(&current, &saved, schema);
    if let Some(note) = note {
        println!("{note}");
    }
    println!("Raw Accel profile \"{}\": putting back your own values, {}.", saved.profile_name, values.describe(schema));
    if options.dry_run {
        println!("Dry run: nothing written.");
        return Ok(());
    }
    warn_if_raw_accel_window_open();
    let next = State { applied: None, ..saved };
    folder.commit(index, &values, &next)?;
    println!("The SprayLab profile is off.");
    Ok(())
}

fn status(options: &Options) -> Result<(), String> {
    let folder = Folder::open(options)?;
    let schema = folder.settings.schema;
    let saved = state::load(&folder.path)?;
    let wanted = options.profile_name.clone().or_else(|| saved.as_ref().map(|state| state.profile_name.clone()));
    let index = folder.settings.select(wanted.as_deref())?;
    let current = folder.settings.fields(index)?;
    println!("Raw Accel folder: {} (Raw Accel {} settings)", folder.path.display(), schema.version);
    println!("Raw Accel profile \"{}\" in settings.json: {}", folder.settings.names()[index], current.describe(schema));
    match &saved {
        None => println!("No SprayLab profile has been applied from this folder."),
        Some(saved) => {
            println!("Your own values: {}", saved.base.describe(schema));
            match saved.applied {
                Some(applied) if current.close(&applied) => {
                    println!("SprayLab profile: ON, {}", saved.direction.describe());
                    println!("  from {} ({} calibration flicks)", saved.source, saved.flicks);
                }
                Some(_) if current.close(&saved.base) => println!("SprayLab profile: off (Raw Accel has your own values back)."),
                Some(_) => println!(
                    "SprayLab profile: applied, but Raw Accel's values changed since; relative to your own they are now {}.",
                    current.relative_to(&saved.base).describe()
                ),
                None => println!("SprayLab profile: off. Last applied: {}", saved.direction.describe()),
            }
        }
    }
    println!("(Raw Accel's driver has these values once writer.exe or Raw Accel's window applied settings.json, as at every start.)");
    if let Some(newest) = profile::downloads_folder().and_then(|folder| profile::newest_in(&folder)) {
        println!("Newest downloaded profile: {}", newest.display());
    }
    Ok(())
}

#[cfg(windows)]
fn run(options: &Options) -> Result<(), String> {
    use spraylab_direction::state::Switch;
    use spraylab_direction::win::{self, Event};
    let hotkey = hotkey::parse(options.hotkey.as_deref().unwrap_or(hotkey::DEFAULT))?;
    let mut folder = Folder::open(options)?;
    let schema = folder.settings.schema;
    let saved = state::load(&folder.path)?;
    let wanted = options.profile_name.clone().or_else(|| saved.as_ref().map(|state| state.profile_name.clone()));
    let index = folder.settings.select(wanted.as_deref())?;
    let name = folder.settings.names()[index].clone();
    let installed = folder.path.join(INSTALLED_PROFILE);
    let source = match &options.profile {
        Some(path) => path.clone(),
        None if installed.is_file() => installed,
        None => newest_download()?,
    };
    let file = profile::load(&source)?;
    let direction = file.direction.scaled(options.strength.unwrap_or(1.0));
    let current = folder.settings.fields(index)?;
    let (base, note) = state::base_for_on(&current, saved.as_ref(), &name, options.rebase, schema)?;
    let template = State::new(&name, base, None, direction, &source.display().to_string(), file.flicks);
    let mut switch = Switch { base, on: base.with(direction), is_on: false };
    show_profile(&source, &file, options.strength);
    println!("  {}", direction.describe());
    if let Some(note) = note {
        println!("{note}");
    }
    show_rotation_caveat(&base, direction.rotation);
    // base_for_on accepted Raw Accel's current values as this program's own, so the first switch may overwrite them.
    let wanted_on = if options.cs2 { win::running("cs2.exe") } else { true };
    let values = if wanted_on { switch.on } else { switch.base };
    if current.close(&values) {
        switch.is_on = wanted_on;
    } else {
        warn_if_raw_accel_window_open();
        folder.commit(index, &values, &State { applied: wanted_on.then_some(values), ..template.clone() })?;
        switch.is_on = wanted_on;
    }
    println!("SprayLab profile {} in Raw Accel profile \"{name}\".", if switch.is_on { "ON" } else { "OFF" });
    println!(
        "Press {} to switch it on or off{}. Close this window to stop; Raw Accel keeps whichever is on at that moment.",
        hotkey.name,
        if options.cs2 { "; it also goes on when CS2 starts and off when CS2 closes" } else { "" }
    );
    let mut cs2_running = wanted_on;
    win::listen(&hotkey, options.cs2.then_some(2000), |event| {
        let on = match event {
            Event::Hotkey => !switch.is_on,
            Event::Tick => {
                let running = win::running("cs2.exe");
                if running == cs2_running {
                    return;
                }
                cs2_running = running;
                running
            }
        };
        if on == switch.is_on {
            return;
        }
        let result = folder.reread().and_then(|()| {
            let current = folder.settings.fields(index)?;
            let values = switch.target(&current, on)?;
            folder.commit(index, &values, &State { applied: on.then_some(values), ..template.clone() })
        });
        match result {
            Ok(()) => {
                switch.is_on = on;
                println!("SprayLab profile {}.", if on { "ON" } else { "OFF" });
                if !options.quiet {
                    win::beep(on);
                }
            }
            Err(error) => eprintln!("{error}"),
        }
    })
}

#[cfg(not(windows))]
fn run(_options: &Options) -> Result<(), String> {
    Err("run needs Windows: it listens for a Windows hotkey and for cs2.exe.".into())
}

/// The batch file in your Startup folder that starts `run` minimized when you sign in.
fn startup_file() -> Result<PathBuf, String> {
    let appdata = std::env::var_os("APPDATA").ok_or("APPDATA is not set, so the Startup folder is unknown.")?;
    Ok(PathBuf::from(appdata).join("Microsoft").join("Windows").join("Start Menu").join("Programs").join("Startup").join("SprayLab Direction.cmd"))
}

fn startup(options: &Options) -> Result<(), String> {
    let file = startup_file()?;
    match options.startup.as_deref() {
        Some("off") => {
            if file.exists() {
                fs::remove_file(&file).map_err(|error| format!("Cannot remove {}: {error}", file.display()))?;
                println!("Removed {}: SprayLab Direction no longer starts when you sign in.", file.display());
            } else {
                println!("SprayLab Direction was not set to start when you sign in.");
            }
            Ok(())
        }
        Some("on") => {
            let folder = rawaccel::find_folder(options.rawaccel.as_deref())?;
            if !folder.join(INSTALLED_PROFILE).is_file() {
                return Err("Apply a profile first (spraylab-direction apply): at sign-in, run uses the profile last applied.".into());
            }
            if let Some(keys) = &options.hotkey {
                hotkey::parse(keys)?;
            }
            let exe = std::env::current_exe().map_err(|error| format!("Cannot find this program's own path: {error}"))?;
            let mut args = vec!["run".to_string(), "--rawaccel".to_string(), quoted(&folder.display().to_string())?];
            if let Some(name) = &options.profile_name {
                args.extend(["--profile-name".to_string(), quoted(name)?]);
            }
            if let Some(strength) = options.strength {
                args.extend(["--strength".to_string(), strength.to_string()]);
            }
            if let Some(keys) = &options.hotkey {
                args.extend(["--hotkey".to_string(), keys.clone()]);
            }
            args.extend(options.cs2.then(|| "--cs2".to_string()));
            args.extend(options.quiet.then(|| "--quiet".to_string()));
            let text = format!(
                "@echo off\r\nrem Starts SprayLab Direction minimized when you sign in. Remove it with: spraylab-direction startup off\r\nstart \"SprayLab Direction\" /min {} {}\r\n",
                quoted(&exe.display().to_string())?,
                args.join(" ")
            );
            if let Some(parent) = file.parent() {
                fs::create_dir_all(parent).map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
            }
            fs::write(&file, text).map_err(|error| format!("Cannot write {}: {error}", file.display()))?;
            println!("SprayLab Direction will start minimized when you sign in ({}).", file.display());
            Ok(())
        }
        _ => Err("startup takes on or off.".into()),
    }
}

/// A batch-file argument in double quotes, with % doubled so cmd does not expand it.
fn quoted(text: &str) -> Result<String, String> {
    if text.contains('"') {
        return Err(format!("{text} contains a double quote, which a startup file cannot pass on."));
    }
    Ok(format!("\"{}\"", text.replace('%', "%%")))
}

fn dispatch(options: &Options) -> Result<(), String> {
    match options.command.as_str() {
        "" => {
            println!("{USAGE}");
            if let Err(error) = status(options) {
                println!("{error}");
            }
            Ok(())
        }
        "help" => {
            print!("{USAGE}");
            Ok(())
        }
        "version" => {
            println!("spraylab-direction {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        "apply" => apply(options),
        "off" => off(options),
        "status" => status(options),
        "run" => run(options),
        "startup" => startup(options),
        other => Err(format!("Unknown command \"{other}\". Run spraylab-direction help.")),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = parse(&args).and_then(|options| dispatch(&options));
    if let Err(error) = &result {
        eprintln!("{error}");
    }
    #[cfg(windows)]
    if (args.is_empty() || result.is_err()) && spraylab_direction::win::owns_console() {
        println!("\nPress Enter to close this window.");
        let _ = std::io::stdin().read_line(&mut String::new());
    }
    if result.is_ok() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

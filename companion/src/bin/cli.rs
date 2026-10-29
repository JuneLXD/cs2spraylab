//! The spraylab-direction-cli command line: apply, off and status, as the window does them.

use spraylab_direction::ops::{self, Report};
use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "\
SprayLab Direction applies a SprayLab Direction Calibration profile to all mouse input through Raw Accel. This is its
command line; spraylab-direction.exe is the window and tray icon, with a hotkey and CS2-only switching.

Usage:
  spraylab-direction-cli apply [PROFILE]   write the profile into Raw Accel's settings and activate it
  spraylab-direction-cli off               put your own values back and activate them
  spraylab-direction-cli status            show your values, the profile and what Raw Accel's settings have now

PROFILE is the file SprayLab downloads (Pop > Direction Calibration > Download profile). Without it, apply takes the
newest spraylab-direction-profile*.json in your Downloads folder.

Options:
  --rawaccel FOLDER    Raw Accel's folder, with writer.exe and settings.json (default: this program's folder)
  --profile-name NAME  the Raw Accel profile to change (default: the first, used by every mouse not assigned another)
  --strength S         apply S (0 to 1) of the profile; the file already includes SprayLab's strength slider
  --rebase             take Raw Accel's current values as your own although they changed after the profile was applied
  --dry-run            show what would change and write nothing

Switch the profile off before calibrating in SprayLab again: SprayLab sees what Raw Accel outputs, so it would measure
on top of the profile. While the profile is on, leave Apply profile in SprayLab off, or SprayLab applies it twice.
";

#[derive(Default)]
struct Options {
    command: String,
    profile: Option<PathBuf>,
    rawaccel: Option<PathBuf>,
    profile_name: Option<String>,
    strength: Option<f64>,
    rebase: bool,
    dry_run: bool,
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
            "--rebase" => options.rebase = true,
            "--dry-run" => options.dry_run = true,
            "-h" | "--help" => positional.insert(0, "help".to_string()),
            "--version" => positional.insert(0, "version".to_string()),
            flag if flag.starts_with("--") => return Err(format!("Unknown option {flag}. Run spraylab-direction-cli help.")),
            _ => positional.push(arg.clone()),
        }
    }
    let mut positional = positional.into_iter();
    options.command = positional.next().unwrap_or_default();
    match options.command.as_str() {
        "apply" => options.profile = positional.next().map(PathBuf::from),
        // Version 0.1's commands, which say where they went; their arguments do not matter.
        "run" | "startup" => positional.by_ref().for_each(drop),
        _ => {}
    }
    if let Some(extra) = positional.next() {
        return Err(format!("Unexpected \"{extra}\". Run spraylab-direction-cli help."));
    }
    Ok(options)
}

fn apply(options: &Options, report: &mut Report) -> Result<(), String> {
    let request = ops::On {
        rawaccel: options.rawaccel.as_deref(),
        profile_name: options.profile_name.as_deref(),
        profile: options.profile.as_deref(),
        strength: options.strength.unwrap_or(1.0),
        rebase: options.rebase,
        dry_run: options.dry_run,
    };
    ops::turn_on(&request, report)?;
    if !options.dry_run {
        println!("Run spraylab-direction-cli off before calibrating in SprayLab again, and leave Apply profile in SprayLab off meanwhile.");
    }
    Ok(())
}

fn dispatch(options: &Options) -> Result<(), String> {
    let mut report = Report::printing();
    match options.command.as_str() {
        "" => {
            println!("{USAGE}");
            if let Err(error) = ops::status(options.rawaccel.as_deref(), options.profile_name.as_deref(), &mut report) {
                println!("{error}");
            }
            Ok(())
        }
        "help" => {
            print!("{USAGE}");
            Ok(())
        }
        "version" => {
            println!("spraylab-direction-cli {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        "apply" => apply(options, &mut report),
        "off" => ops::turn_off(options.rawaccel.as_deref(), options.dry_run, &mut report),
        "status" => ops::status(options.rawaccel.as_deref(), options.profile_name.as_deref(), &mut report),
        "run" | "startup" => Err(format!("{} is in the window now: open spraylab-direction.exe, which has the hotkey, CS2-only switching and Start with Windows.", options.command)),
        other => Err(format!("Unknown command \"{other}\". Run spraylab-direction-cli help.")),
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

//! SprayLab Direction's window and tray icon, a Windows program: no console window opens with it.
#![cfg_attr(windows, windows_subsystem = "windows")]

use std::process::ExitCode;

#[cfg(windows)]
fn main() -> ExitCode {
    spraylab_direction::win::run_app()
}

#[cfg(not(windows))]
fn main() -> ExitCode {
    eprintln!("SprayLab Direction's window and tray icon need Windows. spraylab-direction-cli has apply, off and status everywhere.");
    ExitCode::FAILURE
}

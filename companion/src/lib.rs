//! SprayLab Direction: applies a profile from SprayLab's Direction Calibration to all mouse input through Raw Accel, the
//! signed Windows mouse driver, so CS2 gets the same correction as SprayLab. It edits the five direction values of Raw
//! Accel's settings.json and has Raw Accel's own writer.exe send them to the driver; it never touches a game.

pub mod hotkey;
pub mod profile;
pub mod rawaccel;
pub mod state;
#[cfg(windows)]
pub mod win;

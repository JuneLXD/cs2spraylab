//! The Windows-only parts of `run`: a global hotkey, a timer to look for CS2, beeps, and whether the console window is this
//! program's own (opened by a double click), so a message stays readable before the window closes.

use crate::hotkey::{Hotkey, MOD_NOREPEAT};
use std::ptr::null_mut;
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Console::GetConsoleProcessList;
use windows_sys::Win32::System::Diagnostics::Debug::Beep;
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::RegisterHotKey;
use windows_sys::Win32::UI::WindowsAndMessaging::{GetMessageW, PeekMessageW, SetTimer, MSG, PM_REMOVE, WM_HOTKEY, WM_TIMER};

pub enum Event {
    Hotkey,
    Tick,
}

/// Waits for the hotkey and, every `tick_ms`, a tick, and hands each to `handle` until the process ends. Presses made while
/// `handle` runs (a write takes about a second) are dropped rather than replayed.
pub fn listen(hotkey: &Hotkey, tick_ms: Option<u32>, mut handle: impl FnMut(Event)) -> Result<(), String> {
    unsafe {
        if RegisterHotKey(null_mut(), 1, hotkey.modifiers | MOD_NOREPEAT, hotkey.key) == 0 {
            return Err(format!("Cannot register the hotkey {}: another program already uses it. Pick another with --hotkey.", hotkey.name));
        }
        if let Some(ms) = tick_ms {
            SetTimer(null_mut(), 0, ms, None);
        }
        let mut msg: MSG = std::mem::zeroed();
        loop {
            let got = GetMessageW(&mut msg, null_mut(), 0, 0);
            if got == 0 || got == -1 {
                return Ok(());
            }
            match msg.message {
                WM_HOTKEY => {
                    handle(Event::Hotkey);
                    while PeekMessageW(&mut msg, null_mut(), WM_HOTKEY, WM_HOTKEY, PM_REMOVE) != 0 {}
                }
                WM_TIMER => handle(Event::Tick),
                _ => {}
            }
        }
    }
}

/// Whether a process named `name` (such as cs2.exe) is running.
pub fn running(name: &str) -> bool {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more && !found {
            let length = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            found = String::from_utf16_lossy(&entry.szExeFile[..length]).eq_ignore_ascii_case(name);
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        found
    }
}

/// A short high tone for on, a low one for off.
pub fn beep(on: bool) {
    unsafe {
        Beep(if on { 880 } else { 440 }, 120);
    }
}

/// Whether this program is the only one in its console, as when opened from Explorer.
pub fn owns_console() -> bool {
    let mut processes = [0u32; 2];
    unsafe { GetConsoleProcessList(processes.as_mut_ptr(), 2) == 1 }
}

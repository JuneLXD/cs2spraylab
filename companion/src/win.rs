//! The Windows-only parts: the hotkey and "show yourself" messages on a hidden message window, one copy running at a time,
//! starting at sign-in (the Run key), file dialogs, finding CS2, beeps, message boxes, and starting the window itself.

use crate::app::Env;
use crate::gui::{self, Gui, Host, Setup, Tone};
use crate::hotkey::{Hotkey, MOD_NOREPEAT};
use crate::log::{self, Log};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::ptr::{null, null_mut};
use std::time::Duration;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, ERROR_FILE_NOT_FOUND, HWND, INVALID_HANDLE_VALUE, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::Console::GetConsoleProcessList;
use windows_sys::Win32::System::Diagnostics::Debug::Beep;
use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
};
use windows_sys::Win32::System::Threading::CreateMutexW;
use windows_sys::Win32::UI::Controls::Dialogs::{GetOpenFileNameW, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_HIDEREADONLY, OFN_NOCHANGEDIR, OFN_PATHMUSTEXIST, OPENFILENAMEW};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetActiveWindow, RegisterHotKey, UnregisterHotKey};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, CreateWindowExW, DefWindowProcW, FindWindowExW, GetSystemMetrics, GetWindowThreadProcessId, IsIconic, MessageBoxW, PostMessageW, RegisterClassW, SetForegroundWindow, ShowWindow, HWND_MESSAGE,
    MB_ICONERROR, MB_ICONINFORMATION, MB_OK, MB_SETFOREGROUND, SM_CXSMICON, SW_RESTORE, SW_SHOWNORMAL, WM_APP, WM_HOTKEY, WNDCLASSW,
};

const CLASS: &str = "SprayLabDirection.Messages";
const MUTEX: &str = "Local\\SprayLabDirection";
/// Asks the running copy to show its window.
const WM_SHOW: u32 = WM_APP + 1;
const HOTKEY_ID: i32 = 1;
const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE: &str = "SprayLab Direction";

fn wide(text: impl AsRef<OsStr>) -> Vec<u16> {
    text.as_ref().encode_wide().chain([0]).collect()
}

/// Whether each of `names` (such as cs2.exe) is running, from one process snapshot.
pub fn running(names: &[&str]) -> Vec<bool> {
    let mut found = vec![false; names.len()];
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return found;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            let length = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let exe = String::from_utf16_lossy(&entry.szExeFile[..length]);
            for (name, seen) in names.iter().zip(found.iter_mut()) {
                *seen |= exe.eq_ignore_ascii_case(name);
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    found
}

/// A short high tone for on, a low one for off, two low ones when the switch failed.
pub fn beep(tone: Tone) {
    unsafe {
        match tone {
            Tone::On => Beep(880, 120),
            Tone::Off => Beep(440, 120),
            Tone::Failed => {
                Beep(330, 90);
                Beep(330, 90)
            }
        };
    }
}

/// Whether this program is the only one in its console, as when opened from Explorer.
pub fn owns_console() -> bool {
    let mut processes = [0u32; 2];
    unsafe { GetConsoleProcessList(processes.as_mut_ptr(), 2) == 1 }
}

pub fn message_box(title: &str, text: &str, error: bool) {
    let (title, text) = (wide(title), wide(text));
    let icon = if error { MB_ICONERROR } else { MB_ICONINFORMATION };
    unsafe {
        MessageBoxW(null_mut(), text.as_ptr(), title.as_ptr(), MB_OK | icon | MB_SETFOREGROUND);
    }
}

unsafe extern "system" fn messages(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match message {
        WM_HOTKEY => {
            let _ = slint::invoke_from_event_loop(|| gui::with_current(|gui| gui.hotkey()));
            0
        }
        WM_SHOW => {
            let _ = slint::invoke_from_event_loop(|| gui::with_current(|gui| gui.show()));
            0
        }
        _ => DefWindowProcW(hwnd, message, wparam, lparam),
    }
}

/// A hidden message-only window on the window's thread, for the hotkey and for a second copy asking this one to show.
struct MessageWindow(HWND);

impl MessageWindow {
    fn new() -> Result<MessageWindow, String> {
        let class = wide(CLASS);
        unsafe {
            let instance = GetModuleHandleW(null());
            let mut definition: WNDCLASSW = std::mem::zeroed();
            definition.lpfnWndProc = Some(messages);
            definition.hInstance = instance;
            definition.lpszClassName = class.as_ptr();
            RegisterClassW(&definition);
            let hwnd = CreateWindowExW(0, class.as_ptr(), class.as_ptr(), 0, 0, 0, 0, 0, HWND_MESSAGE, null_mut(), instance, null());
            if hwnd.is_null() {
                return Err(format!("Cannot create the hotkey window (error {}).", GetLastError()));
            }
            Ok(MessageWindow(hwnd))
        }
    }
}

/// Claims the single running copy. False when another copy runs: it has been asked to show its window.
fn claim_single_copy() -> bool {
    let name = wide(MUTEX);
    unsafe {
        // Kept open for the whole run; Windows closes it at exit.
        let mutex = CreateMutexW(null(), 0, name.as_ptr());
        if mutex.is_null() || GetLastError() != ERROR_ALREADY_EXISTS {
            return true;
        }
        let class = wide(CLASS);
        let other = FindWindowExW(HWND_MESSAGE, null_mut(), class.as_ptr(), null());
        if !other.is_null() {
            // This copy was just started, so Windows lets it bring windows forward; pass that on to the running copy.
            let mut process = 0u32;
            GetWindowThreadProcessId(other, &mut process);
            AllowSetForegroundWindow(process);
            PostMessageW(other, WM_SHOW, 0, 0);
        } else {
            message_box("SprayLab Direction", "SprayLab Direction is already running: look for its icon in the tray, next to the clock.", false);
        }
        false
    }
}

/// The Startup-folder batch file version 0.1's `startup on` wrote; replaced by the Run key.
fn old_startup_file() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    Some(PathBuf::from(appdata).join("Microsoft\\Windows\\Start Menu\\Programs\\Startup\\SprayLab Direction.cmd"))
}

fn startup_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|error| format!("Cannot find this program's own path: {error}"))?;
    Ok(format!("\"{}\" --tray", exe.display()))
}

fn run_key(access: u32) -> Result<HKEY, String> {
    let path = wide(RUN_KEY);
    let mut key: HKEY = null_mut();
    let status = unsafe { RegCreateKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, null(), REG_OPTION_NON_VOLATILE, access, null(), &mut key, null_mut()) };
    if status != 0 {
        return Err(format!("Cannot open the sign-in programs list in the registry (error {status})."));
    }
    Ok(key)
}

fn read_run_value() -> Option<String> {
    let key = run_key(KEY_QUERY_VALUE).ok()?;
    let name = wide(RUN_VALUE);
    let mut buffer = vec![0u16; 2048];
    let mut bytes = (buffer.len() * 2) as u32;
    let mut kind = 0u32;
    let status = unsafe { RegQueryValueExW(key, name.as_ptr(), null(), &mut kind, buffer.as_mut_ptr().cast(), &mut bytes) };
    unsafe { RegCloseKey(key) };
    if status != 0 || kind != REG_SZ {
        return None;
    }
    let length = (bytes as usize / 2).min(buffer.len());
    let text = String::from_utf16_lossy(&buffer[..length]);
    Some(text.trim_end_matches('\0').to_string())
}

fn write_run_value(on: bool) -> Result<(), String> {
    let key = run_key(KEY_SET_VALUE)?;
    let name = wide(RUN_VALUE);
    let status = if on {
        let command = match startup_command() {
            Ok(command) => wide(command),
            Err(error) => {
                unsafe { RegCloseKey(key) };
                return Err(error);
            }
        };
        unsafe { RegSetValueExW(key, name.as_ptr(), 0, REG_SZ, command.as_ptr().cast(), (command.len() * 2) as u32) }
    } else {
        match unsafe { RegDeleteValueW(key, name.as_ptr()) } {
            ERROR_FILE_NOT_FOUND => 0,
            status => status,
        }
    };
    unsafe { RegCloseKey(key) };
    if status != 0 {
        return Err(format!("Cannot change the sign-in programs list in the registry (error {status})."));
    }
    Ok(())
}

fn hwnd(window: &slint::Window) -> Option<HWND> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    match window.window_handle().window_handle().ok()?.as_raw() {
        RawWindowHandle::Win32(handle) => Some(handle.hwnd.get() as HWND),
        _ => None,
    }
}

pub struct WinHost {
    messages: MessageWindow,
}

impl Host for WinHost {
    fn running(&self, names: &[&str]) -> Vec<bool> {
        running(names)
    }

    fn pick_file(&self, title: &str, filters: &[(&str, &str)], start: Option<&Path>) -> Option<PathBuf> {
        let mut filter: Vec<u16> = Vec::new();
        for (description, pattern) in filters.iter().chain(&[("All files", "*.*")]) {
            filter.extend(wide(description));
            filter.extend(wide(pattern));
        }
        filter.push(0);
        let title = wide(title);
        let start = start.map(|folder| wide(folder.as_os_str()));
        let mut file = vec![0u16; 4096];
        unsafe {
            let mut dialog: OPENFILENAMEW = std::mem::zeroed();
            dialog.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
            dialog.hwndOwner = GetActiveWindow();
            dialog.lpstrFilter = filter.as_ptr();
            dialog.nFilterIndex = 1;
            dialog.lpstrFile = file.as_mut_ptr();
            dialog.nMaxFile = file.len() as u32;
            dialog.lpstrInitialDir = start.as_ref().map_or(null(), |start| start.as_ptr());
            dialog.lpstrTitle = title.as_ptr();
            dialog.Flags = OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_HIDEREADONLY;
            if GetOpenFileNameW(&mut dialog) == 0 {
                return None;
            }
        }
        let length = file.iter().position(|&c| c == 0).unwrap_or(file.len());
        Some(PathBuf::from(String::from_utf16_lossy(&file[..length])))
    }

    fn startup(&self) -> Option<bool> {
        let current = startup_command().ok();
        Some(read_run_value().is_some_and(|value| Some(value) == current) || old_startup_file().is_some_and(|file| file.is_file()))
    }

    fn set_startup(&self, on: bool) -> Result<(), String> {
        if let Some(file) = old_startup_file().filter(|file| file.is_file()) {
            std::fs::remove_file(&file).map_err(|error| format!("Cannot remove {}: {error}", file.display()))?;
        }
        write_run_value(on)
    }

    fn register_hotkey(&self, hotkey: Option<&Hotkey>) -> Result<(), String> {
        unsafe {
            UnregisterHotKey(self.messages.0, HOTKEY_ID);
            if let Some(hotkey) = hotkey {
                if RegisterHotKey(self.messages.0, HOTKEY_ID, hotkey.modifiers | MOD_NOREPEAT, hotkey.key) == 0 {
                    return Err(format!("{} is in use by another program, so it cannot switch the profile; pick another hotkey.", crate::app::hotkey_label(&hotkey.name)));
                }
            }
        }
        Ok(())
    }

    fn beep(&self, tone: Tone) {
        beep(tone);
    }

    fn open_url(&self, url: &str) {
        let (verb, url) = (wide("open"), wide(url));
        unsafe {
            ShellExecuteW(null_mut(), verb.as_ptr(), url.as_ptr(), null(), null(), SW_SHOWNORMAL);
        }
    }

    fn raise(&self, window: &slint::Window) {
        // Before the event loop runs there is no native window yet; Windows brings a new program's first window forward
        // by itself.
        let Some(hwnd) = hwnd(window) else { return };
        unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            SetForegroundWindow(hwnd);
        }
    }

    fn tray_icon_size(&self) -> u32 {
        (unsafe { GetSystemMetrics(SM_CXSMICON) }).clamp(16, 64) as u32
    }
}

/// The program: the window and tray icon. `--tray` (how sign-in starts it) starts with the window closed.
pub fn run_app() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(command) = args.iter().find(|arg| matches!(arg.as_str(), "apply" | "off" | "status" | "startup")) {
        message_box(
            "SprayLab Direction",
            &format!("The command line moved to spraylab-direction-cli.exe: run spraylab-direction-cli {command} in a terminal. This program is the window and tray icon."),
            false,
        );
        return ExitCode::FAILURE;
    }
    // `run` started version 0.1's background mode, which a Startup-folder file from `startup on` may still do.
    let at_sign_in = args.iter().any(|arg| arg == "--tray" || arg == "run");
    let Some(env) = Env::system() else {
        message_box("SprayLab Direction", "Cannot find your AppData folder (APPDATA is not set), where this program keeps its settings.", true);
        return ExitCode::FAILURE;
    };
    let log = Log::new(env.home.join(log::FILE));
    let crash_log = log.clone();
    std::panic::set_hook(Box::new(move |info| {
        crash_log.write(&format!("Stopped: {info}"));
        message_box("SprayLab Direction stopped", &format!("{info}\n\nDetails are in {}.", crash_log.path.display()), true);
    }));
    if !claim_single_copy() {
        return ExitCode::SUCCESS;
    }
    // The window is dark, so its title bar should be too, from the moment it opens.
    let backend = slint::BackendSelector::new()
        .backend_name("winit".into())
        .with_winit_window_attributes_hook(|attributes| attributes.with_theme(Some(slint::winit_030::winit::window::Theme::Dark)))
        .select();
    if let Err(error) = backend {
        log.write(&format!("Cannot start the window system: {error}"));
        message_box("SprayLab Direction", &format!("Cannot start the window system: {error}"), true);
        return ExitCode::FAILURE;
    }
    let host = match MessageWindow::new() {
        Ok(messages) => WinHost { messages },
        Err(error) => {
            log.write(&error);
            message_box("SprayLab Direction", &error, true);
            return ExitCode::FAILURE;
        }
    };
    let gui = match Gui::new(env, Box::new(host), Setup { inline_jobs: false, tick: Some(Duration::from_secs(2)), tray: true }) {
        Ok(gui) => gui,
        Err(error) => {
            log.write(&format!("Cannot open the window: {error}"));
            message_box("SprayLab Direction", &format!("Cannot open the window: {error}"), true);
            return ExitCode::FAILURE;
        }
    };
    if !at_sign_in {
        gui.show();
    }
    gui.start_up(at_sign_in);
    let result = slint::run_event_loop_until_quit();
    // Dropping the window also removes the tray icon.
    drop(gui);
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            log.write(&format!("The window stopped: {error}"));
            ExitCode::FAILURE
        }
    }
}

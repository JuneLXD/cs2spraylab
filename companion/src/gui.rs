//! The window and tray icon on screen: `MainWindow` and `Tray` from ui/app.slint, filled from `app::Controller`'s view,
//! with their callbacks wired back to it. Everything that needs Windows goes through `Host`, so tests can run the window
//! headless (see `headless`).

slint::include_modules!();

use crate::app::{self, Controller, Env, Job, Source, View, Work};
use crate::hotkey::{self, Hotkey};
use crate::icon;
use crate::ops::Report;
use slint::{ComponentHandle, Image, ModelRc, SharedPixelBuffer, SharedString, VecModel};
use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::{Rc, Weak};
use std::time::Duration;

pub const RAW_ACCEL_RELEASES: &str = "https://github.com/RawAccelOfficial/rawaccel/releases";

/// A beep for the hotkey.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Tone {
    On,
    Off,
    Failed,
}

/// The Windows side of the window: dialogs, processes, starting at sign-in, the hotkey and sounds.
pub trait Host {
    /// Whether each of `names` (such as cs2.exe) is running.
    fn running(&self, names: &[&str]) -> Vec<bool>;
    /// An open-file dialog with `filters` as (description, pattern); none when cancelled.
    fn pick_file(&self, title: &str, filters: &[(&str, &str)], start: Option<&Path>) -> Option<PathBuf>;
    /// Whether this program starts when you sign in; none where that cannot be set.
    fn startup(&self) -> Option<bool>;
    fn set_startup(&self, on: bool) -> Result<(), String>;
    /// Registers `hotkey` in place of the previous one; none removes it.
    fn register_hotkey(&self, hotkey: Option<&Hotkey>) -> Result<(), String>;
    fn beep(&self, tone: Tone);
    fn open_url(&self, url: &str);
    /// Brings the window to the front once it is shown.
    fn raise(&self, window: &slint::Window);
    /// The tray icon's size in pixels.
    fn tray_icon_size(&self) -> u32;
}

/// How the window runs.
pub struct Setup {
    /// Run jobs on the window's thread (tests) rather than on a worker thread.
    pub inline_jobs: bool,
    /// How often to look at CS2, Raw Accel and the downloads; none for never (tests call `tick`).
    pub tick: Option<Duration>,
    pub tray: bool,
}

struct Icons {
    on: Image,
    off: Image,
    attention: Image,
    tray_on: Image,
    tray_off: Image,
    tray_attention: Image,
}

fn image(size: u32, glyph: [u8; 3]) -> Image {
    Image::from_rgba8(SharedPixelBuffer::clone_from_slice(&icon::rgba(size, glyph), size, size))
}

pub struct Gui {
    pub controller: RefCell<Controller>,
    pub window: MainWindow,
    tray: Option<Tray>,
    host: Box<dyn Host>,
    inline_jobs: bool,
    timer: slint::Timer,
    visible: Cell<bool>,
    quit_when_done: Cell<bool>,
    shown: RefCell<Option<View>>,
    icons: Icons,
}

thread_local! {
    static CURRENT: RefCell<Weak<Gui>> = const { RefCell::new(Weak::new()) };
}

/// Runs `f` with the window, when there is one: finished jobs and Windows messages reach it this way.
pub fn with_current(f: impl FnOnce(&Rc<Gui>)) {
    let gui = CURRENT.with(|current| current.borrow().upgrade());
    if let Some(gui) = gui {
        f(&gui);
    }
}

fn strings(items: &[String]) -> ModelRc<SharedString> {
    ModelRc::new(VecModel::from(items.iter().map(SharedString::from).collect::<Vec<_>>()))
}

fn display(view: &View) -> Display {
    let text = |value: &str| SharedString::from(value);
    let rows: Vec<ValueRow> =
        view.raw_rows.iter().map(|row| ValueRow { name: text(&row.name), yours: text(&row.yours), other: text(&row.other), changed: row.changed }).collect();
    Display {
        phase: view.phase,
        tone: view.tone,
        state: text(&view.state),
        tag: text(&view.tag),
        tag_tone: view.tag_tone,
        action: text(&view.action),
        action_enabled: view.action_enabled,
        summary: text(&view.summary),
        hint: text(&view.hint),
        update: view.update,
        can_locate: view.can_locate,
        has_profile: view.has_profile,
        profile_name: text(&view.profile_name),
        profile_detail: text(&view.profile_detail),
        flicks: text(&view.flicks),
        right: text(&view.gains[0]),
        left: text(&view.gains[1]),
        up: text(&view.gains[2]),
        down: text(&view.gains[3]),
        rotation: text(&view.gains[4]),
        right_sign: view.signs[0],
        left_sign: view.signs[1],
        up_sign: view.signs[2],
        down_sign: view.signs[3],
        rotation_sign: view.signs[4],
        newer: text(&view.newer),
        raw_folder: text(&view.raw_folder),
        raw_version: text(&view.raw_version),
        raw_rows: ModelRc::new(VecModel::from(rows)),
        raw_other: text(&view.raw_other),
        raw_profiles: strings(&view.raw_profiles),
        raw_profile_enabled: view.raw_profile_enabled,
        hotkeys: strings(&view.hotkeys),
        warning: text(&view.warning),
        message: text(&view.message),
        error: view.error,
    }
}

impl Gui {
    pub fn new(env: Env, host: Box<dyn Host>, setup: Setup) -> Result<Rc<Gui>, slint::PlatformError> {
        let window = MainWindow::new()?;
        let tray = if setup.tray { Some(Tray::new()?) } else { None };
        let size = host.tray_icon_size();
        let icons = Icons {
            on: image(64, icon::ON),
            off: image(64, icon::OFF),
            attention: image(64, icon::ATTENTION),
            tray_on: image(size, icon::ON),
            tray_off: image(size, icon::OFF),
            tray_attention: image(size, icon::ATTENTION),
        };
        window.set_logo(image(96, icon::ON));
        let startup = host.startup();
        window.set_startup_available(startup.is_some());
        window.set_startup(startup.unwrap_or(false));
        let gui = Rc::new(Gui {
            controller: RefCell::new(Controller::new(env)),
            window,
            tray,
            host,
            inline_jobs: setup.inline_jobs,
            timer: slint::Timer::default(),
            visible: Cell::new(false),
            quit_when_done: Cell::new(false),
            shown: RefCell::new(None),
            icons,
        });
        CURRENT.with(|current| *current.borrow_mut() = Rc::downgrade(&gui));
        gui.wire();
        gui.register_hotkey();
        if let Some(every) = setup.tick {
            let weak = Rc::downgrade(&gui);
            gui.timer.start(slint::TimerMode::Repeated, every, move || {
                if let Some(gui) = weak.upgrade() {
                    gui.tick();
                }
            });
        }
        gui.controller.borrow().log.write(&format!("SprayLab Direction {} started", env!("CARGO_PKG_VERSION")));
        gui.render();
        Ok(gui)
    }

    fn wire(self: &Rc<Self>) {
        let w = &self.window;
        let weak = Rc::downgrade(self);
        let call = |f: fn(&Rc<Gui>)| {
            let weak = weak.clone();
            move || {
                if let Some(gui) = weak.upgrade() {
                    f(&gui);
                }
            }
        };
        w.on_act(call(|gui| gui.toggle(Source::Window)));
        w.on_update_profile(call(|gui| gui.start(Job::On, Source::Window)));
        w.on_restore(call(|gui| gui.start(Job::Off, Source::Window)));
        w.on_keep(call(|gui| gui.start(Job::Keep, Source::Window)));
        w.on_locate(call(|gui| gui.locate()));
        w.on_get_raw_accel(call(|gui| gui.host.open_url(RAW_ACCEL_RELEASES)));
        w.on_choose_profile(call(|gui| gui.choose_profile()));
        w.on_use_newer(call(|gui| gui.change(|controller| controller.use_newer())));
        w.on_quit(call(|gui| gui.quit()));
        let strength = weak.clone();
        w.on_strength_chosen(move |value| {
            if let Some(gui) = strength.upgrade() {
                gui.change(|controller| controller.set_strength(value as f64));
            }
        });
        let with_index = |f: fn(&Rc<Gui>, usize)| {
            let weak = weak.clone();
            move |index: i32| {
                if let (Some(gui), Ok(index)) = (weak.upgrade(), usize::try_from(index)) {
                    f(&gui, index);
                }
            }
        };
        w.on_hotkey_chosen(with_index(|gui, index| gui.choose_hotkey(index)));
        w.on_raw_profile_chosen(with_index(|gui, index| gui.change(|controller| controller.set_raw_accel_profile(index))));
        let with_flag = |f: fn(&Rc<Gui>, bool)| {
            let weak = weak.clone();
            move |on: bool| {
                if let Some(gui) = weak.upgrade() {
                    f(&gui, on);
                }
            }
        };
        w.on_cs2_only_toggled(with_flag(|gui, on| {
            gui.change(|controller| controller.set_cs2_only(on));
            gui.tick();
        }));
        w.on_beep_toggled(with_flag(|gui, on| gui.change(|controller| controller.set_beep(on))));
        w.on_startup_toggled(with_flag(|gui, on| gui.set_startup(on)));
        let hide = weak.clone();
        w.window().on_close_requested(move || {
            if let Some(gui) = hide.upgrade() {
                gui.visible.set(false);
            }
            slint::CloseRequestResponse::HideWindow
        });
        if let Some(tray) = &self.tray {
            tray.on_toggle(call(|gui| gui.toggle(Source::Tray)));
            tray.on_open(call(|gui| gui.show()));
            tray.on_quit(call(|gui| gui.quit()));
        }
    }

    pub fn tray(&self) -> Option<&Tray> {
        self.tray.as_ref()
    }

    /// Changes a setting in the controller and shows the result; the last job's message gives way.
    fn change(&self, f: impl FnOnce(&mut Controller)) {
        let mut controller = self.controller.borrow_mut();
        controller.message = None;
        f(&mut controller);
        drop(controller);
        self.render();
    }

    pub fn toggle(self: &Rc<Self>, source: Source) {
        let work = self.controller.borrow_mut().toggle(source);
        self.run(work);
    }

    pub fn start(self: &Rc<Self>, job: Job, source: Source) {
        let work = self.controller.borrow_mut().begin(job, source);
        self.run(work);
    }

    /// The hotkey was pressed.
    pub fn hotkey(self: &Rc<Self>) {
        let work = self.controller.borrow_mut().toggle(Source::Hotkey);
        if work.is_none() && self.controller.borrow().options.beep {
            self.host.beep(Tone::Failed);
        }
        self.run(work);
    }

    fn run(self: &Rc<Self>, work: Option<Work>) {
        self.render();
        let Some(work) = work else { return };
        if self.inline_jobs {
            let (report, result) = work.run();
            self.finish(report, result);
            return;
        }
        std::thread::spawn(move || {
            let (report, result) = work.run();
            let _ = slint::invoke_from_event_loop(move || with_current(|gui| gui.finish(report, result)));
        });
    }

    fn finish(self: &Rc<Self>, report: Report, result: Result<(), String>) {
        let ok = result.is_ok();
        let done = self.controller.borrow_mut().finish(report, result);
        let (beep, on) = {
            let controller = self.controller.borrow();
            (controller.options.beep, controller.is_on())
        };
        if let Some((_, Source::Hotkey)) = done {
            if beep {
                self.host.beep(if !ok { Tone::Failed } else if on { Tone::On } else { Tone::Off });
            }
        }
        self.render();
        if self.quit_when_done.get() {
            self.quit();
        }
    }

    /// Looks at CS2, Raw Accel's window, settings.json and, while the window shows, the downloads.
    pub fn tick(self: &Rc<Self>) {
        let (cs2_only, visible) = (self.controller.borrow().options.cs2_only, self.visible.get());
        let running = if cs2_only || visible { self.host.running(&["cs2.exe", "rawaccel.exe"]) } else { vec![false, false] };
        let work = {
            let mut controller = self.controller.borrow_mut();
            controller.raw_accel_window = running[1];
            if controller.busy.is_none() {
                controller.refresh(visible);
            }
            controller.cs2(running[0])
        };
        self.run(work);
    }

    /// Done once at start: with the profile on, sends settings.json to the driver again, which forgets its settings at
    /// every restart (unless CS2 decides instead).
    pub fn start_up(self: &Rc<Self>, at_sign_in: bool) {
        let reapply = {
            let controller = self.controller.borrow();
            at_sign_in && controller.is_on() && !controller.options.cs2_only
        };
        if reapply {
            self.start(Job::Reapply, Source::Start);
        }
        self.tick();
    }

    pub fn show(self: &Rc<Self>) {
        self.visible.set(true);
        self.controller.borrow_mut().refresh(true);
        self.render();
        if let Err(error) = self.window.show() {
            self.controller.borrow().log.write(&format!("Cannot show the window: {error}"));
        }
        self.host.raise(self.window.window());
    }

    pub fn quit(self: &Rc<Self>) {
        if self.controller.borrow().busy.is_some() {
            // Let writer.exe finish, so settings.json and this program's state agree.
            self.quit_when_done.set(true);
            return;
        }
        self.controller.borrow().log.write("Quit");
        let _ = self.window.hide();
        let _ = slint::quit_event_loop();
    }

    fn register_hotkey(&self) {
        let name = self.controller.borrow().options.hotkey.clone();
        let result = match name.as_str() {
            "" => self.host.register_hotkey(None),
            name => hotkey::parse(name).and_then(|hotkey| self.host.register_hotkey(Some(&hotkey))),
        };
        let problem = result.err();
        if let Some(problem) = &problem {
            self.controller.borrow().log.write(problem);
        }
        self.controller.borrow_mut().hotkey_problem = problem;
        self.render();
    }

    fn choose_hotkey(&self, index: usize) {
        let (names, _) = self.controller.borrow().hotkeys();
        if let Some(name) = names.get(index) {
            let mut controller = self.controller.borrow_mut();
            controller.message = None;
            controller.set_hotkey(name);
            drop(controller);
            self.register_hotkey();
        }
    }

    fn set_startup(&self, on: bool) {
        let result = self.host.set_startup(on);
        self.controller.borrow_mut().message = result.err().map(|error| (error, true));
        self.controller.borrow().log.write(&format!("Start with Windows: {on}"));
        self.window.set_startup(self.host.startup().unwrap_or(false));
        self.render();
    }

    fn locate(&self) {
        let start = self.controller.borrow().raw.as_ref().ok().map(|raw| raw.folder.clone());
        if let Some(path) = self.host.pick_file("Locate Raw Accel's writer.exe", &[("Raw Accel's writer.exe", "writer.exe")], start.as_deref()) {
            self.change(|controller| controller.set_raw_accel(&path));
        }
    }

    fn choose_profile(&self) {
        let start = self.controller.borrow().env.downloads.clone();
        if let Some(path) = self.host.pick_file("Choose a SprayLab direction profile", &[("SprayLab direction profile (*.json)", "*.json")], start.as_deref()) {
            self.change(|controller| controller.choose_profile(path));
        }
    }

    /// Puts the controller's view on screen, when it changed.
    pub fn render(&self) {
        let view = self.controller.borrow().view();
        if self.shown.borrow().as_ref() == Some(&view) {
            return;
        }
        let w = &self.window;
        w.set_display(display(&view));
        w.set_strength(view.strength);
        w.set_hotkey_index(view.hotkey);
        w.set_raw_profile_index(view.raw_profile);
        w.set_cs2_only(view.cs2_only);
        w.set_beep(view.beep);
        let (window_icon, tray_icon) = match (view.phase, view.tone) {
            (app::ON, _) => (&self.icons.on, &self.icons.tray_on),
            (_, app::GREY) => (&self.icons.off, &self.icons.tray_off),
            _ => (&self.icons.attention, &self.icons.tray_attention),
        };
        w.set_window_icon(window_icon.clone());
        if let Some(tray) = &self.tray {
            tray.set_picture(tray_icon.clone());
            tray.set_tip(view.tooltip.as_str().into());
            tray.set_on(view.is_on);
            tray.set_working(view.phase == app::WORKING);
            let hotkey = self.controller.borrow().options.hotkey.clone();
            tray.set_hotkey_text(if hotkey.is_empty() { SharedString::new() } else { app::hotkey_label(&hotkey).into() });
        }
        *self.shown.borrow_mut() = Some(view);
    }
}

/// Drawing the window without a screen, for tests and screenshots: Slint's software renderer into a pixel buffer.
pub mod headless {
    use slint::platform::software_renderer::{MinimalSoftwareWindow, PremultipliedRgbaColor, RepaintBufferType};
    use slint::platform::{Platform, WindowAdapter, WindowEvent};
    use slint::PhysicalSize;
    use std::cell::RefCell;
    use std::rc::Rc;

    /// Hands out `first` to the first component that asks for a window (the main window, which asks while it registers
    /// its fonts), and a window of its own to every later one: the tray component asks too, for the same reason, and
    /// sharing would put it in the main window's place.
    struct Headless {
        first: RefCell<Option<Rc<MinimalSoftwareWindow>>>,
    }

    impl Platform for Headless {
        fn create_window_adapter(&self) -> Result<Rc<dyn WindowAdapter>, slint::PlatformError> {
            let window = self.first.borrow_mut().take().unwrap_or_else(|| MinimalSoftwareWindow::new(RepaintBufferType::NewBuffer));
            Ok(window)
        }
    }

    /// Makes the first Slint window created on this thread draw into the returned window; call once, before creating
    /// any.
    pub fn install() -> Rc<MinimalSoftwareWindow> {
        let window = MinimalSoftwareWindow::new(RepaintBufferType::NewBuffer);
        let platform = Headless { first: RefCell::new(Some(window.clone())) };
        slint::platform::set_platform(Box::new(platform)).expect("the headless platform is installed once");
        window
    }

    /// Draws the window at `width` x `height` pixels (at `scale` pixels per logical pixel) as straight RGBA.
    pub fn render(window: &MinimalSoftwareWindow, width: u32, height: u32, scale: f32) -> Vec<u8> {
        window.dispatch_event(WindowEvent::ScaleFactorChanged { scale_factor: scale });
        window.set_size(PhysicalSize::new(width, height));
        slint::platform::update_timers_and_animations();
        window.request_redraw();
        let mut buffer = vec![PremultipliedRgbaColor::default(); (width * height) as usize];
        window.draw_if_needed(|renderer| {
            renderer.render(&mut buffer, width as usize);
        });
        buffer
            .iter()
            .flat_map(|pixel| {
                let alpha = pixel.alpha.max(1) as u32;
                let straight = |channel: u8| ((channel as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
                [straight(pixel.red), straight(pixel.green), straight(pixel.blue), pixel.alpha]
            })
            .collect()
    }
}

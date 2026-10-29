# SprayLab Direction: the Raw Accel companion

SprayLab Direction applies a profile from SprayLab's Direction Calibration (Pop) to all mouse input through
[Raw Accel](https://github.com/RawAccelOfficial/rawaccel), the signed Windows mouse driver, so CS2 gets the same
correction SprayLab measured. It changes five values of one Raw Accel profile in Raw Accel's `settings.json` (Output DPI,
the Y/X, L/R and U/D ratios, and the rotation) and has Raw Accel's own `writer.exe` send them to the driver. It never reads
or touches a game, and nothing in it depends on where targets are.

It comes as two programs:

- `spraylab-direction.exe`: the window and a tray icon, in SprayLab's look. Use this one.
- `spraylab-direction-cli.exe`: the same apply, off and status from a terminal.

## Setup

1. Install Raw Accel 1.7 (1.6 also works): run `installer.exe` from its release zip, restart Windows, then open
   `rawaccel.exe` once so it writes `settings.json`.
2. Put `spraylab-direction.exe` in Raw Accel's folder, next to `writer.exe`. Elsewhere, it asks you to locate `writer.exe`.
3. In SprayLab, with no direction profile on anywhere, calibrate in Pop > Direction Calibration (48 flicks at least, 144
   recommended), then press Download profile. The window picks up the newest download by itself.
4. Open `spraylab-direction.exe` and press Turn on.

## The window

- **Status card:** ON or OFF in large letters, what that means, and the button to switch. When Raw Accel is missing or
  no profile was downloaded yet, it says what to do and offers Locate writer.exe or Choose profile.
- **Profile:** the profile's four directions around a dial with its rotation. Gold means more sensitive that way, blue
  less. A strength slider applies part of the profile; while it is on, changing the strength or the file shows Apply
  changes. A newer download in your Downloads folder is offered with Use it.
- **Raw Accel:** your own five values beside the ones with the profile (or what Raw Accel has now), and Locate Raw Accel.
- **Switching:** the hotkey (Ctrl+Alt+P by default, also in game; None turns it off), On only while CS2 runs (on when
  `cs2.exe` starts, off when it closes; the hotkey still works between), a beep on the hotkey (high for on, low for off,
  two low ones when it failed) and Start with Windows, which starts it in the tray when you sign in.

Closing the window keeps it running in the tray, next to the clock (Windows 11 may put new icons under the ^ arrow). Click
the icon to open the window; right-click it to switch or quit. The icon is green while the profile is on, grey while off,
and amber while switching or when Raw Accel needs a look. Only one copy runs: starting it again opens the running one.

Its settings are in `%APPDATA%\SprayLab Direction\options.json`, and `log.txt` beside them records what it did.

## Command line

| Command | What it does |
| --- | --- |
| `spraylab-direction-cli apply [PROFILE]` | Writes the profile into Raw Accel and activates it. Without a path it takes the newest `spraylab-direction-profile*.json` in your Downloads folder. |
| `spraylab-direction-cli off` | Puts your own values back and activates them. |
| `spraylab-direction-cli status` | Shows your own values, what `settings.json` has now and whether the profile is on. |

Options: `--rawaccel FOLDER` for Raw Accel's folder when the program is not in it; `--profile-name NAME` changes another
Raw Accel profile than the first; `--strength S` applies S (0 to 1) of the profile; `--dry-run` shows the change and writes
nothing; `--rebase` is explained below. Both programs keep the same records, so either can switch off what the other
switched on.

## How it combines with your Raw Accel settings

SprayLab measures your flicks through your current Raw Accel settings, so the profile goes on top of them. Raw Accel
rotates the input, applies its curve and Output DPI, multiplies y by Y/X, then negative x by L/R and negative y by U/D. So
per direction the multipliers multiply and the rotations add: Output DPI x right, Y/X x down/right, L/R x left/right,
U/D x up/down, rotation plus the profile's (minus it when your Y/X is negative, which mirrors the screen). That is exact
when your own ratios are even, as they are by default. If they are not, the added rotation is approximate, and the
program says by how much (typically well under 1% of a movement).

- Your values from before the profile are kept in `spraylab-direction-state.json` beside `settings.json`, and switching
  off restores exactly those. The first change also keeps your original file as `settings.json.spraylab-backup`.
- Applying a new profile replaces the old one; it never stacks.
- If `writer.exe` refuses the settings, `settings.json` is put back as it was.
- Close Raw Accel's window before switching: if you then press Apply in it, it writes back the values it loaded. Its
  window has no L/R or U/D fields, which is why this program edits `settings.json` directly. The window warns while
  `rawaccel.exe` is open.
- If Raw Accel's values change while the profile is on (say you pressed Apply in its window), the window shows Check Raw
  Accel and offers Restore my values (your own from before the profile, profile off) or Keep these values (if they have
  no profile in them, for example after you reset Raw Accel). The command line refuses instead; `apply --rebase` keeps them.
- Raw Accel's driver keeps no settings across restarts. Raw Accel's window, or `writer.exe settings.json` at startup,
  applies `settings.json` again, profile included. Started with Windows, this program also sends it once at sign-in while
  the profile is on.

## Before you rely on it

- Calibrate with the Raw Accel profile off. SprayLab sees what Raw Accel outputs, so it would measure on top of the
  profile. While the profile is on, leave Apply profile in SprayLab off, or SprayLab applies it a second time.
- Check that it helps with SprayLab's blind A/B test. A direction profile is a small, fixed correction. Whether it
  makes anyone aim better is not established, Corsair's PureVector claims included. Most first-movement error is
  flick-to-flick variation that no profile removes.
- Raw Accel's driver waits a second before taking new settings, which is its anti-cheat safeguard, so each switch takes
  about a second. Raw Accel's FAQ says it works in FACEIT and Valorant matches; neither Raw Accel nor this program can
  guarantee how an anti-cheat treats it. The hotkey is an ordinary Windows hotkey, and `writer.exe` runs without a console
  window, so switching in game does not take the focus from it.
- The programs are not code-signed, so Windows SmartScreen may warn the first time (More info > Run anyway).

## Building and tests

`cargo test` runs 27 unit tests, 7 end-to-end tests of the command line, and a test of the window itself: it builds the
real window headless with Slint's software renderer, drives it through its buttons against a temporary Raw Accel folder
whose `writer.exe` is a stand-in script, checks what it shows and writes in each state, and saves a screenshot of each in
`target/tmp/screenshots`. The end-to-end and window tests need Linux or macOS. `tests/fixtures` holds a profile downloaded
from SprayLab's live build and a Raw Accel 1.7 default `settings.json`, reconstructed from Raw Accel 1.7.1's source
(`DriverConfig` in `wrapper/wrapper.cpp`, defaults in `common/rawaccel-base.hpp`).

The window is written in [Slint](https://slint.dev) (`ui/app.slint`, used here under the GPL like the rest of this
repository) and drawn by its software renderer, so the screenshots match what Windows shows. Its fonts are SprayLab's
Rajdhani and Barlow (`ui/fonts`, SIL Open Font License), built into the program. The icon is drawn in code
(`src/icon.rs`).

Build the Windows programs from Linux with Zig 0.14.1 and cargo-zigbuild 0.23.4 (both on PATH):

    cargo zigbuild --release --target x86_64-pc-windows-gnu

The build uses `zig rc` for the icon, version information and manifest; elsewhere the programs build without them. Or
build on Windows with `cargo build --release`. The Windows-only parts (the tray icon, hotkey, finding CS2, Start with
Windows, file dialogs and beeps) compile and pass clippy for Windows, but have not run on Windows yet; nor has either
program been run against a real Raw Accel install.

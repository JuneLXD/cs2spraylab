# SprayLab Direction: the Raw Accel companion

`spraylab-direction.exe` applies a profile from SprayLab's Direction Calibration (Pop) to all mouse input through
[Raw Accel](https://github.com/RawAccelOfficial/rawaccel), the signed Windows mouse driver, so CS2 gets the same
correction SprayLab measured. It changes five values of one Raw Accel profile in Raw Accel's `settings.json` (Output DPI,
the Y/X, L/R and U/D ratios, and the rotation) and has Raw Accel's own `writer.exe` send them to the driver. It never reads
or touches a game, and nothing in it depends on where targets are.

## Setup

1. Install Raw Accel 1.7 (1.6 also works): run `installer.exe` from its release zip, restart Windows, then open
   `rawaccel.exe` once so it writes `settings.json`.
2. Put `spraylab-direction.exe` in Raw Accel's folder, next to `writer.exe`. (Elsewhere, pass `--rawaccel FOLDER`.)
3. In SprayLab, with no direction profile on anywhere, calibrate in Pop > Direction Calibration (48 flicks at least, 144
   recommended), then press Download profile.

Double-clicking the program shows its help and status. Everything else runs from a terminal in that folder.

## Commands

| Command | What it does |
| --- | --- |
| `spraylab-direction apply [PROFILE]` | Writes the profile into Raw Accel and activates it. Without a path it takes the newest `spraylab-direction-profile*.json` in your Downloads folder. |
| `spraylab-direction off` | Puts your own values back and activates them. |
| `spraylab-direction status` | Shows your own values, what `settings.json` has now and whether the profile is on. |
| `spraylab-direction run [PROFILE]` | Stays open. Ctrl+Alt+P (or `--hotkey KEYS`) switches the profile on and off, with a high beep for on and a low one for off. With `--cs2` it is on only while `cs2.exe` runs. It uses the profile last applied. |
| `spraylab-direction startup on [run options]` | Starts `run` minimized when you sign in to Windows, through a batch file in your Startup folder. `startup off` removes it. |

Options: `--profile-name NAME` changes another Raw Accel profile than the first; `--strength S` applies S (0 to 1) of
the profile (the file already includes SprayLab's strength slider); `--dry-run` shows the change and writes nothing;
`--quiet` turns off the beeps; `--rebase` is explained below.

## How it combines with your Raw Accel settings

SprayLab measures your flicks through your current Raw Accel settings, so the profile goes on top of them. Raw Accel
rotates the input, applies its curve and Output DPI, multiplies y by Y/X, then negative x by L/R and negative y by U/D. So
per direction the multipliers multiply and the rotations add: Output DPI x right, Y/X x down/right, L/R x left/right,
U/D x up/down, rotation plus the profile's (minus it when your Y/X is negative, which mirrors the screen). That is exact
when your own ratios are even, as they are by default. If they are not, the added rotation is approximate, and the
program prints by how much (typically well under 1% of a movement).

- Your values from before the profile are kept in `spraylab-direction-state.json` beside `settings.json`, and `off`
  restores exactly those. The first change also keeps your original file as `settings.json.spraylab-backup`.
- Applying a new profile replaces the old one; it never stacks.
- If `writer.exe` refuses the settings, `settings.json` is put back as it was.
- Close Raw Accel's window before applying: if you then press Apply in it, it writes back the values it loaded. Its
  window has no L/R or U/D fields, which is why this program edits `settings.json` directly.
- If Raw Accel's values change while the profile is on (say you changed sensitivity in its window), `apply` refuses to
  guess. Run `off`, make the change in Raw Accel, and apply again. If you reset the values to ones with no profile in
  them, `apply --rebase` keeps them as your own.
- Raw Accel's driver keeps no settings across restarts. Raw Accel's window, or `writer.exe settings.json` at startup,
  applies `settings.json` again, profile included. `run --cs2` (with `startup on`) switches it itself.

## Before you rely on it

- Calibrate with the Raw Accel profile off. SprayLab sees what Raw Accel outputs, so it would measure on top of the
  profile. While the profile is on, leave Apply profile in SprayLab off, or SprayLab applies it a second time.
- Check that it helps with SprayLab's blind A/B test. A direction profile is a small, fixed correction. Whether it
  makes anyone aim better is not established, Corsair's PureVector claims included. Most first-movement error is
  flick-to-flick variation that no profile removes.
- Raw Accel's driver waits a second before taking new settings, which is its anti-cheat safeguard, so each switch takes
  about a second. Raw Accel's FAQ says it works in FACEIT and Valorant matches; neither Raw Accel nor this program can
  guarantee how an anti-cheat treats it.

## Building and tests

`cargo test` runs 22 unit tests and 8 end-to-end tests of the built program. The end-to-end tests run against a
temporary Raw Accel folder whose `writer.exe` is a stand-in script, so they need Linux or macOS. The tests cover the
profile file, the Raw Accel 1.7 and 1.6 formats, the composition against Raw Accel's transform, on/off bookkeeping,
outside changes, a failing writer, strength, dry runs, startup files and hotkey parsing. `tests/fixtures` holds a profile
downloaded from SprayLab's live build and a Raw Accel 1.7 default `settings.json`, reconstructed from Raw Accel 1.7.1's
source (`DriverConfig` in `wrapper/wrapper.cpp`, defaults in `common/rawaccel-base.hpp`).

Build the Windows program from Linux with Zig 0.14.1 and cargo-zigbuild 0.23.4 (both on PATH):

    cargo zigbuild --release --target x86_64-pc-windows-gnu

Or build it on Windows with `cargo build --release`. The Windows-only parts (the hotkey, finding CS2, beeps and
keeping a double-clicked window open) compile and pass clippy for Windows. They have not yet run on Windows; nor has
the program been run against a real Raw Accel install.

# Aim report

Every mode that shoots records the same aim report, and the **Aim** tab in the main menu shows it in two views: **Session report**
and **Direction calibration** (below), which every mode feeds since 2026-10-30. Reports can be downloaded. A report covers one
session: from entering a mode until a new session, a setup change that restarts the drill, or leaving the mode. It is saved
whenever you pause, at the end of a round or timed session, and when the session ends. AI Duel rounds of one session share
a report. The browser keeps the latest 60 reports (`spraylab.aim.reports.v1`), newest first. The tab picks a session by
mode and compares it with your previous session of the same mode (for Pop, the same exercise).

Code: `src/range/aim-report.ts` (recorder, analysis, tips, calibration flicks), `src/range/aim-report-store.ts` (storage),
`src/range/aim-report-export.ts` (downloads), `src/range/direction-calibration.ts` (calibration settings), `src/range/aim-vector.ts`
(the direction analysis) and `src/range/ui/screens/AimScreen.tsx` (the tab). Tests: `aim-report.test.ts` (synthetic flicks,
strafes, sprays, clicks and calibration flicks), `aim-report-engines.test.ts` (the real range and duel simulations),
`direction-calibration.test.ts`, `aim-report-export.test.ts` and `ui/screens/AimScreen.test.ts`. Reports saved before the later metrics still load: every
field added since is optional.

## What the engines feed it

Both engines own one `AimRecorder` and attach it to their simulation (`Simulation.aimLog`, `DuelSimulation.aimLog`).

- **Mouse look** (`look`): every mouse movement that turned the view, in degrees to the right and down, at its simulation
  time. View angles never include recoil: they are what your mouse controls.
- **Every simulation step** (`frame`, 128 Hz): your eye, view, velocity, the weapon's running speed (mode specific: a
  scoped AWP's is lower), the movement keys and stance, and the targets in view.
- **Shots** (`shot`): bullets and the Zeus, not the knife. The first shot of each trigger press is a *click*.
- **Hits and kills** (`hit`, `clear`).

Targets per mode:

| Mode | Targets | Notes |
| --- | --- | --- |
| Pop (all exercises) | each ball, with its radius | a ball behind a solid peek wall is out of view; with Wallbang on it counts as in view. Micro Flicks' one ball is a new target after every hop. Held-fire exercises (Pokeball, DriftTS) fire no shots: the crosshair touching a ball while fire is held is its hit. |
| Peeking, Counterstrafing, Burst & reposition | the dummy's head while it is exposed | each repetition is a new target; a hit never "kills" it. |
| Guided, Free spray, Spray transfer | the dummy's head | shot statistics only: a target that never goes away has no flicks. |
| AI Duel, Deathmatch, Blitz, Aim Botz, aim_redline, Reflex | each bot's head while you can see it | sight lines and your field of view, sampled every four steps as the duel coach does; a respawned bot is a new target. The zone is 0.12 m around the head point (the native head hitbox is a 4.3-unit capsule). |

## Flicks

A flick runs from where its window starts to your first hit on that target. The window starts when the target came into
view or at your last shot or kill on anything else, whichever is later, and at most 4 s before the hit. When the target came
into view after your last other activity (and not at the start of the round), the flick is *fresh*: only then is the time
before moving a reaction.

The mouse path in the window is split exactly as Direction Calibration splits a flick (`segmentMovement` in
`aim-vector.ts`): resampled every 2 ms, smoothed, the first push past 30% of the largest is the first movement, and it ends
where speed falls below 10% of its peak (or at an earlier dip that a new push follows). Later pushes are corrections. A
fresh flick that starts within 80 ms is a guess and is set aside; a chained flick may start at once.

Where the first movement landed is where the **target** was, relative to the crosshair, when the first movement ended. So a
moving target, or you strafing, is accounted for: the movement it needed is the first movement plus that remaining offset.
`along` is how far the first movement went toward it (1 exactly), *inside* means it ended inside the target's zone. Flicks
whose first movement went under 20% or over 250% of the way, or more than 45° off, are set aside as before. A target that
appeared already within 0.5° (or its zone) of your crosshair needed no flick: it counts as crosshair placement instead.
Crosshair placement (the median angle to targets as they appeared, and the share already under the crosshair) is reported in
the AI Duel modes and the range drills, not in Pop, whose exercises put targets away from the crosshair on purpose.

Time to hit splits into four phases that add up: **before moving** (your reaction for fresh flicks), the **first movement**,
**adjusting** (after it, until the crosshair came onto the target for the last time) and **on target before the shot**.
The report shows their means, so the bar adds up to the mean time to hit; the tile shows the median. A window that began
when the session or round did (the target was already there and you had not done anything yet), or that was cut at 4 s,
holds idle time rather than a flick: it still counts for where the first movement landed, but for no time.

By flick size (under 5°, 5–12°, 12–25°, over 25°): the overall bias (geometric mean of `along`, minus 1), the typical miss
(RMS of the landing error as a share of the flick) and the median time to hit.

## Shooting while moving

Every shot gets a state from your horizontal speed as a share of the weapon's running speed:

- **Moving**: above 34%. CS2's movement inaccuracy starts there (`movementInaccuracy` in `ballistics.ts`).
- **In the air**: jumping or falling.
- **Stopped**: at or below 34%, after running above 50% within the last 0.6 s.
- **Standing**: no running in the last 0.6 s.

For a shot after running, the recorder looks back for the stop: the first step after the movement keys last pushed along
your velocity. The stop is a **counter-strafe** when the opposite direction was pressed before you became accurate, a
**release** when you only let go, and **did not stop** when the key was still held at the shot. It records the time from
starting the stop to the shot, and the time from becoming accurate (speed at or below 34%) to the shot: negative is too
early, filled in once you do become accurate; more than 100 ms counts as late. The report also gives your own median time
from starting a stop to being accurate, separately for counter-strafes and releases.

## Clicks

At the first shot of each trigger press, the recorder measures how fast the target was crossing your crosshair over the
last 30 ms (degrees per second): the target's movement relative to your view, so following a moving target counts as
settled. Under 30°/s is *settled*. A shot belongs to the target it hit, else to the nearest target within 4° of the
crosshair (or three times its zone). With no target near, it is the crosshair's own speed.

## Pace and consistency

- **Throughput** (bits per second, Fitts): for each timed flick, log2 of the distance over the target's width (twice its zone
  radius) plus 1, divided by the time from starting to move to the hit; the mean of at least five flicks. It is nominal
  throughput (the target's size, not the spread of your endpoints), and it only compares fairly within one drill and target size.
- **First-movement top speed**: the median peak speed of first movements (degrees per second).
- **Spread**: the middle half (25th to 75th percentile) of reaction times and times to hit, and the *scatter* of first movements:
  one standard deviation of log(`along`), as a share of the flick. A bias bigger than the scatter is a habit; scatter bigger than
  the bias is consistency.
- **Halves**: from 10 shots on, the session's first and second half (shots in order, timed flicks in the order of their hits):
  shots, hit rate and median time to hit.
- **Targets per minute** (from 10 s of play) and the median time to clear a target.

## Flicks by direction

This session's measured flicks, in any mode, by the direction of the movement they needed on screen: eight 45-degree sectors
(right, up-right, up, ...), each with its first-movement bias, typical miss and time to hit. The panel also says how many of the
session's flicks went into Direction calibration (`calibration`, while it records) and opens that view.

## Bursts, misses and stance

- **By shot in a press**: hit rate of the first shot, the 2nd–3rd, the 4th–10th and the 11th on, from each shot's place in its
  trigger press (both engines count it: the range's shot index, the duel's shots since fire was last up).
- **Why shots missed**: missed shots with a target near are split by whether the crosshair was on the target at the shot (spread,
  recoil or moving did it) or off it (aim).
- **Stance**: crouched and walking shots, with their hit rates (a shot can be both, and also standing, stopped or moving).
- **Stops by side**: stops while strafing left and right (mostly sideways relative to your view when the key last pushed you),
  with how many came before you were accurate and the median time to accurate.

## Direction calibration

The Aim tab's second view: an open, measured take on Corsair's PureVector (Sabre v3 Pro with Aimlabs), which writes eight hidden
per-direction DPI values into the mouse after five SpiderShot rounds. From 2026-10-28 to 2026-10-30 it was a Pop exercise of
its own (`popVariant: 'vector'`: rest on a center dot, one target at an exact offset, 16 directions at three sizes per round);
now every mode feeds it, and a setup saved in the exercise opens as Classic Pop.

- **Recording** (`directionCalibrate`, on by default; the view's **Record calibration flicks** switch). While on, each engine's aim
  recorder keeps every flick that measures your aim cleanly as a calibration flick (`AimRecorder.keepCalibration`): a valid,
  timed flick (as above) that ended with a shot hitting the target while the crosshair was on it, so that was where you meant
  to go; 2-45 degrees long (`CALIBRATION_AMP`) to a target whose angular radius is at most a fifth of that (`CALIBRATION_ZONE`);
  with recoil, view punch and, in the duel engine, the punch of being hit all under 0.05 degrees from 50 ms before the first
  movement started; and with that movement made by the mouse with one state of the profile throughout. Left out: touch input,
  held-fire Pop exercises (the crosshair touching the target ends the flick in the middle of the movement), targets already
  under the crosshair, anticipated starts and first movements that went far off, flicks whose window began with the session or
  ran over 4 s, and the spray drills' fixed targets. Both engines give the recorder each mouse event's view movement and the
  one its counts would have made without the profile (`AimMouse`). The record is in mouse space (`FlickRecord`, `aim-vector.ts`):
  the target where it was when the first movement ended (so a moving target and your own movement count), where that movement
  ended without and with the profile, the inverted axes and the profile in use. The engines add the session's calibration
  flicks to `spraylab.direction.v1` (newest 3,000) when its report is saved, so nothing is written to storage mid-play. Switch
  recording off while Raw Accel applies a profile: SprayLab sees Raw Accel's output and would measure on top of it.
- **Results**: the chart of where first movements land in 16 directions with 95% intervals, the fitted four- and
  sixteen-direction profiles, the gap report, the per-direction table, the profile table, Use fitted profile, Apply profile in
  SprayLab, Profile strength, the blind A/B test, the Raw Accel fields, Copy and Download profile, and Clear recorded flicks. They
  cover every calibration flick in this browser, so they show without any session report. Directions with fewer than 3 flicks
  are named, since their part of the fit is loose.
- **Analysis** (`segmentMovement`, `analyzeFlick`): the movement is resampled every 2 ms (each event spread over at most one 60 Hz
  frame) and Gaussian-smoothed (8 ms). The first movement is the first push past 30% of the largest; it starts when the crosshair
  last left its resting place (1% of the distance) and ends at 10% of its peak speed or at an earlier dip below half that a new
  push follows. Later pushes past 12% count as corrections.
- **Profile** (`DirectionProfile`): rotation, then right/left/up/down multipliers on mouse counts before the sensitivity, in exactly
  Raw Accel's order and rotation formula (`modify` in RawAccelOfficial/rawaccel common/rawaccel.hpp), so a profile proven here
  behaves identically in its signed driver. `rawAccelFields` maps it: Output DPI x right, Y/X = down/right, L/R = left/right,
  U/D = up/down, same Degrees of rotation. `fitDirectionProfile` fits it by weighted least squares on where first movements of
  calibration flicks (profile off, the latest 480) land relative to their targets: closed-form per half-axis, rotation by grid and
  golden-section search, one Huber pass. The horizontal scale it implies is your sensitivity: reported, never applied. Each part is
  shrunk toward no change by its bootstrap standard error (40 resamples; priors 5% per multiplier, 1.5 degrees) and bounded to
  -20%/+25% and 10 degrees. `directionStrength` blends it in (multipliers as powers).
- **Gap report** (`compareDirectionModels`): 5-fold cross-validated RMS endpoint error, as a fraction of the flick distance, as
  recorded, after the best sensitivity and rotation change alone, after the four-direction profile, and after a full-resolution
  model (that profile plus a smooth correction over direction: a turn and a Fourier gain to the third harmonic, light ridge). It
  reports how much direction-dependent sensitivity could fix and what share the four-direction profile captures, or that there is
  no reliable pattern.
- **Blind A/B test** (`directionTest`): in every mode, while recording, the profile is on or off for whole blocks of 16 calibration
  flicks (`DIRECTION_TEST_BLOCK`), in balanced pairs drawn anew each session, without saying which (`AimRecorder.testOn`; both
  engines apply it through `activeDirectionProfile`). A flick whose first movement spans a switch is left out.
  `compareProfileTest` compares the geometric-mean time to hit (ratio with a Welch 95% interval on log times), first-movement
  error and first-shot hits once both sides have 32 flicks.
- **CS2 through Raw Accel**: Download profile writes the `directionProfileFile` JSON. The Rust companion in `companion/` (see its
  README) composes it with your own Raw Accel values and applies it through Raw Accel's writer.exe, with a window, a tray icon
  and a hotkey.
- **Settings**: `directionCalibrate`, `directionProfile`, `directionProfileOn`, `directionStrength` and `directionTest` are personal
  mouse settings outside Pop presets. The profile applies to mouse input in every range mode and in AI Duel, Deathmatch, Aim Botz,
  Reflex and Blitz, never to touch input.
- **Limits**: flicks from every mode are less controlled than the old exercise. Directions come as the modes give them (Aim Botz
  is mostly horizontal), flick and target sizes vary, and many flicks start right after a shot, so fewer of them qualify and some
  directions fill slowly. A first movement in the trainer is not proof of in-game improvement; adaptation changes your motor
  output under a new profile, so recalibrate with it off after a while; and there is no independent evidence yet that
  direction-dependent sensitivity, PureVector's included, makes players faster. The blind test exists to answer that for you.

## Downloads

- **Download report** saves a self-contained page (`aimReportHtml` in `aim-report-export.ts`): the tips, the key numbers and every
  section of the session report with the numbers written out, and Direction calibration with its chart drawn in SVG when there
  are calibration flicks. It opens in any browser and prints to PDF. File name: `spraylab-aim-report-<mode>-<date>.html`.
- **Download data** saves the same session as JSON (format `spraylab-aim-report`, version 1): the report object and, with
  calibration flicks, their summary, the 16-direction table, the fit, the gap report, the blind test and the profile in use.
- **Download all reports** saves every report this browser keeps (format `spraylab-aim-reports`).

## Tips

Up to three, the most costly first, each only with enough evidence: shots in the air (2 or more and at least 3% of shots),
moving shots (3 or more and at least 15%), stops (at least 5 counter-strafes or releases: too early if 30% came before
accuracy, mostly releases if half, or a wait over 120 ms once accurate), a first-movement bias of 8% or more over at least
8 flicks (otherwise 1.5 corrections per flick or more), 150 ms or more on target before clicking, clicks with the target
still moving that hit at least 15 points less often than settled ones (5 or more, a quarter of clicks), crosshair placement
6° or more off over at least 5 appearances, and under half of at least 8 targets hit with the first shot. With none of
these and at least 10 shots, the tab says so. Two more join them: stops from one side at least 30 ms slower to accurate than
from the other, or 25 points more often too early (at least 4 stops each way), and most misses coming with the crosshair on
the target (at least 8 misses, 60% of them).

## Limits

- Thresholds such as 30°/s for a settled click, 100 ms for a late shot and the tips' cut-offs are judgement calls, chosen to
  separate clear habits from noise. They are not CS2 or esports standards. The 34% accurate speed is CS2's.
- The target offset is sampled each 128 Hz step and interpolated between steps; mouse movement keeps its own event times.
  Phase boundaries are good to about one step (8 ms).
- In AI Duel the head point is the perception model's (head height minus crouch), not the animated hitbox, and sight is
  sampled every four steps, so a bot "appears" up to 31 ms after its first visible frame.
- Spray drills have no flicks, and held-fire Pop exercises have no shot or movement statistics.
- Reports are per browser, like the rest of SprayLab's history.

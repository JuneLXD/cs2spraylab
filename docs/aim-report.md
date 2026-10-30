# Aim report

Every mode that shoots records the same aim report, and the **Aim** tab in the main menu shows it. A report covers one
session: from entering a mode until a new session, a setup change that restarts the drill, or leaving the mode. It is saved
whenever you pause, at the end of a round or timed session, and when the session ends. AI Duel rounds of one session share
a report. The browser keeps the latest 60 reports (`spraylab.aim.reports.v1`), newest first. The tab picks a session by
mode and compares it with your previous session of the same mode (for Pop, the same exercise).

Code: `src/range/aim-report.ts` (recorder, analysis, tips), `src/range/aim-report-store.ts` (storage),
`src/range/ui/screens/AimScreen.tsx` (the tab). Tests: `aim-report.test.ts` (synthetic flicks, strafes and clicks),
`aim-report-engines.test.ts` (the real range and duel simulations), `ui/screens/AimScreen.test.ts`.

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

## Tips

Up to three, the most costly first, each only with enough evidence: shots in the air (2 or more and at least 3% of shots),
moving shots (3 or more and at least 15%), stops (at least 5 counter-strafes or releases: too early if 30% came before
accuracy, mostly releases if half, or a wait over 120 ms once accurate), a first-movement bias of 8% or more over at least
8 flicks (otherwise 1.5 corrections per flick or more), 150 ms or more on target before clicking, clicks with the target
still moving that hit at least 15 points less often than settled ones (5 or more, a quarter of clicks), crosshair placement
6° or more off over at least 5 appearances, and under half of at least 8 targets hit with the first shot. With none of
these and at least 10 shots, the tab says so.

## Limits

- Thresholds such as 30°/s for a settled click, 100 ms for a late shot and the tips' cut-offs are judgement calls, chosen to
  separate clear habits from noise. They are not CS2 or esports standards. The 34% accurate speed is CS2's.
- The target offset is sampled each 128 Hz step and interpolated between steps; mouse movement keeps its own event times.
  Phase boundaries are good to about one step (8 ms).
- In AI Duel the head point is the perception model's (head height minus crouch), not the animated hitbox, and sight is
  sampled every four steps, so a bot "appears" up to 31 ms after its first visible frame.
- Spray drills have no flicks, and held-fire Pop exercises have no shot or movement statistics.
- Reports are per browser, like the rest of SprayLab's history.

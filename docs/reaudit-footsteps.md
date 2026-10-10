# Footstep trigger and cadence re-audit

The previous 1.35 m distance accumulator made steady running footsteps too fast.
Both engines now share the installed game's normal-ground countdown and speed
gate, sampled before movement. This pass covers flat, dry normal movement; it
does not establish complete native footstep audio parity.

The before measurement is from `cb47b69`. The current native server SHA-256 is
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
The portable before/after result is
[evidence/reaudit-footsteps.json](evidence/reaudit-footsteps.json); the raw native
instruction fixture is `src/range/native-footsteps-fixture.json`.

## Primary evidence and call phase

Current-server REA replies and decompiles are retained under
`../native-audit/rea/out/reaudit-footsteps-*`. The relevant evidence is:

| Path | Evidence ID | Established rule |
|---|---|---|
| Base generator | `ev_e65e3a005fd1a0547400e58fe88d21dca7749d73ea995296f5ca331d80fe0f45` | Decrement positive countdown by movement frame time in milliseconds, clamp at zero, then apply emission gates |
| CS timer override | `ev_ff851329e3503d324165f7a7c0b1013c4b73583493a0a7f6c41a884001fc3a7f` | Dry-ground reload is 400 ms below 220 u/s and 300 ms at or above 220; duck flag adds 100 ms |
| Movement update | `ev_dea0164124364aab993e3dfa8ae6a6328b52993aa380add8317df9732239a41e` | Walking or speed below 135.2 u/s bypasses the base timer; speed squared below 10 resets it to 300 ms, plus 100 when ducked |
| Timer callers | `ev_5c20b00b82520a09c811c4d36b3c9991287155e4d275fcab99c986623591faee` | Reset helper has additional conditional callers; ordinary landing is not an unconditional reset |
| Landing check | `ev_f88e58bd3ec13e22ac79b17036b21f2896e5660f0db71ef6a371e1e510d438a1` | Special landing paths depend on impact speed and state |

The normal movement caller invokes the footstep hook before Duck, Jump and
WalkMove. Its outer movement loop runs prepared command fractions with frame
time equal to the fraction difference times the 1/64-second tick interval.
`tools/reaudit-footsteps-command.py` executes the actual native command producer
and its CS override with controlled commands. It returns:

| Supplied input edge | Native command end fractions |
|---|---|
| None | 1 |
| 0.25 | 0.25, 1 |
| 0.5 | 0.5, 1 |
| 0.9 | 0.90625, 1 |

There is no unconditional half-tick split in this normal unchanged-input case.
Therefore a 400 ms countdown expires after 26 ordinary commands (406.25 ms),
and a 300 ms countdown after 20 (312.5 ms). The earlier 304.6875 ms knife
candidate came from calling the raw timer at the trainer's 128 Hz physics rate;
the native producer evidence supersedes that candidate.

The command probe uses native instructions, with accessor/time-offset and
`fmodf` imports supplied as host shims. It does not emulate the full native
scheduler or replace a live command capture. Raw native disassembly and
`native-command-segments.json` remain in `../native-audit/reports/`.

## Implemented rule and measurements

`FootstepCadence` retains pre-movement velocity/stance across the trainer's
128 Hz subdivisions, advances at 64 Hz command boundaries, and closes a partial
segment when movement input or yaw changes. Slow movement preserves the pending
countdown; coming to rest restarts it. Airborne movement can exhaust the clock
without emitting, allowing the next eligible grounded command to emit. Pose
resets, respawns and range cancellation discard pending movement samples.

`tools/reaudit-footsteps-native.py` executes the current wrapper, base generator
and timer override in Unicorn. Scene accessors and final sound emission are
bounded stubs. Its 64 raw cases include the disabled-footsteps convar branch;
63 enabled cases are committed for production comparison. Six sustained
sequences separately cover raw 128 Hz calls and the established 64 Hz command
cadence for AK, AWP and knife.

`tools/reaudit-footsteps.mjs` measures actual sound callbacks over collision-free
1.5-second traversals in both engines, after 0.5 seconds at rest. Both engines
give identical results:

| Equipment / state | Before interval | Native ordinary-command interval | After interval | Maximum interval error before → after |
|---|---:|---:|---:|---:|
| AK, running at 215 u/s | 242.1875–250 ms | 406.25 ms | 406.25 ms | 164.0625 → 0 ms |
| AWP, running at 200 u/s | 265.625–273.4375 ms | 406.25 ms | 406.25 ms | 140.625 → 0 ms |
| Knife, running at 250 u/s | 210.9375–218.75 ms | 312.5 ms | 312.5 ms | 101.5625 → 0 ms |
| Walking, all three | No callbacks | Gate suppresses ordinary steps | No callbacks | Matched bounded gate |
| Fully crouched movement, all three | No callbacks | Speed stays below the gate | No callbacks | Matched bounded gate |

The sustained intervals follow the countdown reload, not the first-step delay.
Starting after rest uses the separate 300 ms countdown and acceleration through
the speed gate. No input-to-audible-onset latency is inferred from these rows.

The final focused run passed **187 tests**, including **82 footstep cases** and
the movement, range, Duel and changelog regressions. Both actual engines test
pre-movement sampling and a walking edge partway through a command. Other tests
cover countdown boundaries, slow-motion preservation, air/ground transitions,
wall contact, pose changes and cancelling a pending range sound. TypeScript
passes. Browser/audio playback and full-suite validation are separate checks.
The timer uses native float32 arithmetic: six fractional boundary cases expose
two emission disagreements with double arithmetic, both corrected. For example,
0.1 ms remaining minus a supplied 0.0001-second frame leaves a positive native
residual, so that call does not emit; double arithmetic incorrectly reached zero.

The final combined suite passes 2,325 unit cases, with only the known missing
fallback-model fixture failing. TypeScript and all five targeted Chromium cases
pass. The serial browser run checks input, held-trigger continuity and camera
response; it does not establish audio loudness or native audible-onset parity.
Auto-deploy was paused during this browser verification.

## Audio observations and remaining limits

- The native generator supplies scalar volume 0.2 below 220 u/s and 0.5 at or
  above it, multiplied by 0.65 when ducked. The machine-code probe observes
  0.13/0.325 for those ducked cases. These scalars are evidence, not a calibrated
  browser gain: this change does not alter the mixer.
- The fresh `game_sounds_footsteps.vsndevts` export has SHA-256
  `a5e880fb7f55be614163bb9058b10dd39f318411e6891448f5bfb6cdb09dfccc`.
  `Base.Footstep` uses the Footsteps group, 0.15-second event blocking, base
  volume 0.9 with variation from -0.1 to 0, 20 u positional offset and native
  distance/occlusion settings. Event blocking is not the movement cadence.
- Earlier AK output-monitor audio has a plausible roughly 400 ms run sequence;
  it supports the order of magnitude only. Gappy video and uncertain capture
  alignment cannot establish first-step latency. The AWP waveform was not a
  clean independent cadence measurement. No fresh knife capture completed.
- Exact native input-fraction quantization and weapon/jump/landing-specific
  command splits are not reproduced. The trainer's input delivery and event
  presentation remain bounded by its own simulation subdivisions.
- Water, ladders, separate moving-jump/hard-landing sounds, freeze/death flags,
  surface routing, client prediction/transport, loudness, occlusion and hearing
  distance still need matched native/trainer cases. The new normal-ground rule
  does not claim those cases are complete.
- A prior 75/500 u native listener branch is not proof of sound transmission
  radii. Its retained code selects an entity-listener response; the caller's
  complete role and propagation path remain unresolved. Similarly, failure to
  find direct server readers for the audible-threshold/forced-volume/animation
  suppression convar pointers is a bounded search result, not proof they have
  no effect elsewhere.

Further runtime evidence should use separate game-only audio/video capture,
stable flat AK/AWP/knife legs with decoded velocities, walking/crouching and
release/restart transitions. A client-side call trace or synchronized event
timestamps is needed for delivery/onset parity; a calibrated listener-distance
and surface sweep is needed for the audio model.

## Reproduction

From `cs2spraylab/`, with the installed binary and local Python native-audit
dependencies available:

```sh
python3 tools/reaudit-footsteps-native.py --fixture
python3 tools/reaudit-footsteps-command.py
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 node tools/reaudit-footsteps.mjs ../native-audit/reports/reaudit-footsteps/trainer-after.json
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 npm run test:run -- src/range/footsteps.test.ts src/range/changelog.test.ts src/range/native-movement-reaudit.test.ts src/range/simulation.test.ts src/range/duel/simulation.test.ts --maxWorkers=1
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 npx tsc --noEmit
```

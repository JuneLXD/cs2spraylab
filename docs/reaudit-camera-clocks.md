# Camera recoil clocks: independent pass 22

Baseline `5356f9b`; evidence-only follow-up. Production behavior is unchanged.
The camera-only kick needs two native clocks. Correct decay and impulse formulas
do not establish the timestamp supplied by the firing path. A schedule-only
change improves some replay samples but does not reproduce the native rule.
The portable [results](evidence/reaudit-camera-clocks.json) retain exact numbers,
binary/report hashes, coverage and limits.

## Primary evidence

The installed client and server match the hashes in the portable report.
`tools/reaudit-camera-native.py` executes their actual camera sampler, ordinary
time accessor and impulse instructions in private Unicorn memory. Only the
transcendental math calls are host shims. Across both binaries, 512 sampler
cases and 72 impulse cases agree exactly with the trainer's corresponding
arithmetic after explicit native clock conversion. Four current-client setter
cases preserve the supplied tick/fraction pair. The decay coefficient 18 is
supplied to this bounded bench; this does not turn an unavailable legacy console
query into a newly observed runtime default.

The sampler decays the previously stored angle using the current game/prediction
time. The firing path adds its impulse and stores the incoming command-history
tick/fraction as the new anchor. The current-client and retained current-server
callers show that these inputs are separate. The client predicted-time branch
and complete render loop are outside this ordinary-clock emulation.

`tools/reaudit-camera-anchor-clocks.py` parses the four original AK demos again:
52 shots and 48 consecutive-shot pairs. It independently reproduces recoil RNG
arithmetic from the hash-bound parameter file; it does not execute the native
RNG. Each shot's aim anchor is its camera anchor plus 1/128 s, within 9.32e-10 s.
Recovery001 and recovery002 held bursts have camera anchors about 3.415 and
4.106 ms before their schedules. Shooting001 also contains a camera anchor
one full tick after its schedule. These are observations, not offsets to fit.

For carried camera angles, sampling at the float32 shot schedule and storing
the recorded command anchor reduces maximum cumulative discrepancy across all
four demos to 0.000228 degrees. Network angle quantization bounds the precision
of that comparison. The old 14-shot fixture really matches its original demo,
but its anchor/schedule differences are only 0.044–0.111 ms; it was insufficient
to establish the general caller clock.

## Why the command anchor differs

The current-server attack resolver is inspected with bounded Capstone reads.
The embedded `cs_usercmd.proto`, RTTI-linked generated parsers, six field stores
and eight resolver reads independently identify the player and render clocks,
and the primary/secondary attack-start history indices. This is static evidence;
it does not establish which branch each recorded shot executed.

With a valid attack index, the resolver uses that entry's player tick/fraction,
converts its tick domain and clamps it between current time minus three ticks
and current time plus one tick. It retains the render pair separately. Its
fallback uses the next-attack pair, a cached timing difference and a 32-entry
history ring. The caller updates the cache from the resolved pair and current
time. When the current pair equals the shot schedule and the calculated candidate
is retained, that recurrence preserves the initial burst offset. This explains
the constant observed offsets conditionally, without assigning a magic delay.

The trainer has a monotonic DOM/render input clock and held-trigger deadlines.
It does not have the corresponding native command history or attack-start
indices. Replacing processing time with scheduled time cannot supply those
missing inputs.

## Trainer measurement

`tools/reaudit-camera-replay.mjs` loads the actual `ViewPunch` implementation.
Recorded shot times/impulses are exogenous inputs. Its comparison clock is the
demo row's game time, not an observed display timestamp or reconstructed browser
input. Errors below are maximum two-axis camera-only angular discrepancies at
those chosen sample times; they are not full-engine screen errors.

| Recording | Shots | Current processing-clock class | Schedule-only candidate | Two recorded clocks candidate |
|---|---:|---:|---:|---:|
| Recovery001 | 8 | 0.372116° | 0.122518° | 0.000151° |
| Recovery002 | 8 | 0.499441° | 0.134188° | 0.000130° |
| Shooting001 | 22 | 0.342209° | 0.177648° | 0.000192° |
| Original AK002 | 14 | 0.387260° | 0.002438° | 0.000198° |

The recorded-clock candidate is a diagnostic requiring native metadata. It is
not a deployable trainer correction. No production constant, camera anchor or
weapon-model recoil share is changed in this pass.

## Continuous video comparison

The approved Recovery002 recording retains 1,071 decoded frames, a maximum
34 ms container gap and no gap over 50 ms. The scene-rotation bench measures
386 frames between 2.5 and 8.983 s relative to the 3 s frame, masking HUD, weapon
and the large position overlay. At least 227 scene matches survive each frame;
maximum homography fit residual is 0.385 pixels at 960×540 resolution.
Native world projection uses focal lengths 360/360 in that resized image.
Alternative intrinsics are retained only as diagnostics.

One constant video/game clock offset, with no amplitude, scale, FOV or per-shot
fit, gives two-axis RMS 0.09055° for recorded aim plus camera kick, versus
0.11085° for recorded aim alone. The full model still has a 1.24452° maximum
residual. Manually inspected on-screen GameTime values vary by about 49.7 ms
relative to container time across four selected frames. Continuous recording
therefore does not establish uniform native frame timing. The residual cannot
justify tuning recoil constants or claiming rendered parity. These are native
scene measurements, not a trainer screen comparison or input-to-photon latency.

## Reproduction and next evidence

Use the existing `native-audit/python` packages and retained installed game,
demos and parsed tick exports. Pause auto-deploy, confirm its service is inactive
and run every step serially. Prefix Node with the required memory/swap cap;
the Python video/native steps were also bounded (2–4 GiB, CPU 200%). No game,
browser, network service or fresh Ghidra analysis is launched by these probes.

```sh
audit_run() { systemd-run --user --scope --quiet -p MemoryMax=4G -p MemorySwapMax=0 -p CPUQuota=200% "$@"; }
audit_run python3 tools/reaudit-camera-native.py
audit_run python3 tools/reaudit-camera-anchor-clocks.py
audit_run python3 tools/reaudit-attack-history-inspect.py --all
audit_run python3 tools/reaudit-attack-history-schema.py
audit_run python3 tools/reaudit-attack-history-fields.py
audit_run node tools/reaudit-camera-replay.mjs
audit_run python3 tools/reaudit-camera-measure.py ../native-audit/reports/native_reaudit_recovery_002.mkv ../native-audit/reports/reaudit-recovery002-camera.json 2.5 9 3
audit_run python3 tools/reaudit-camera-video.py
audit_run python3 tools/reaudit-camera-report.py
```

To justify a live correction, retain per-shot attack-start index and selected
history player/render pairs; current-time and tick-domain state at resolution
and sampling; resolver branch and cache before/after; next-attack pair; and the
history ring when fallback runs. Then establish how native client input history
is constructed from input/render frames so browser timestamps can be compared.
Rendered comparison additionally needs each captured native frame's actual game
clock and prediction state. The current evidence narrows that work; it does not
close complete camera, landing, viewmodel or input fidelity.

## Delivery validation

TypeScript passes. The full unit suite has 2,325 passes and only the documented
missing `public/models/ak47.json` fallback fixture failure. Both Chromium cases
in `tests/view-punch.spec.ts` pass (Duel and guided range). These browser checks
protect existing behavior; they do not prove the missing native history mapping.
Runs were serial, memory/swap capped, with one worker and repository edits frozen
during Chromium. Logs are retained as
`../native-audit/reports/reaudit-camera-{typescript,unit,browser}.log`; the unit
JSON report retains individual results. No application code or assets changed.

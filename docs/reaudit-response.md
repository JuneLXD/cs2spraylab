# Input and perceived-response re-audit

Baseline `c488943`. This inventory separates measured browser arithmetic from
native rendered behavior. `tools/reaudit-response.mjs` exercises the actual
input clock, mouse conversion, frame pacer, viewmodel projection and simulation
footstep callbacks. Its compact result is committed in
[evidence/reaudit-response-summary.json](evidence/reaudit-response-summary.json).
Run it from the repository under `systemd-run --user --scope --quiet -p
MemoryMax=8G -p MemorySwapMax=0`. Movement windows are bounded to 1.5 seconds
and each sound event records position and speed; earlier four-second windows
reached the range boundary and must not be interpreted as sustained free travel.

Current native configuration is retained in
[evidence/reaudit-runtime-settings.json](evidence/reaudit-runtime-settings.json).
Approved native demos, input logs, videos and game-output audio are retained in
`../native-audit/reports/native_reaudit_*`. Capture audio used the output monitor
with CS2 as its only stream. The first clips have large decoded presentation-
timestamp gaps despite a nominal 60fps header. They cannot establish continuous
60Hz camera, viewmodel or flash timing.

| Mechanic | Game evidence / rule | Trainer before → after | Status | Implementation commit |
|---|---|---|---|---|
| Pointer lock / raw input | Native OS input path was not instrumented by these captures | Requests unadjusted pointer lock, retries standard pointer lock, retains drag fallback; unchanged | Native delivery unverified; browser fallback measured separately | `c488943` |
| Sensitivity / yaw / pitch | Fresh configured native sensitivity1 and yaw/pitch .022 | .022° per count at sensitivity1; all12 count/sensitivity samples match arithmetic; unchanged | Matched configured conversion; device/OS count parity unverified | `c488943` |
| Subtick click timestamp | Native command fractions and recorded scheduled shot anchors; see movement/combat inventories | Monotonic input clock flushes elapsed old-input state before edges; stale timestamp cannot rewind, gap capped at250ms; unchanged | Approximated integration; exact physical delivery unverified | `c488943` |
| Input→simulation→render | Native video lacks synchronized device edge/presentation instrumentation | Browser tests record DOM dispatch, shot and renderer submission; no production delay tuned | CPU/browser response measured; native and physical mouse-to-photon unverified | `c488943` |
| Frame pacing | Native engine presentation is outside demo sampling | Synthetic60/144/240Hz clocks, limits0/60/120; uncapped renders every supplied frame; unchanged | Trainer measured, native comparison unverified | `c488943` |
| Low-latency canvas | No native presentation equivalence established | Requests desynchronized WebGL2 when enabled, rejects software-renderer path, falls back to regular context; unchanged | Browser implementation only; actual scanout benefit unverified | `c488943` |
| Shot camera / aim punch | Hash-bound camera sampler and fresh native recoil anchors; combat fixture samples same processing times | .45 physical punch share plus view punch; scheduled recoil corrected in pass18 | Matched bounded native arithmetic; complete rendered camera unverified | `e85f59a` |
| Crosshair on shot | Current-client saved pixel conversion and recoil-follow evidence; earlier bounded arithmetic retained | Render-time sample and pixel snapping retained; unchanged in this pass | Bounded prior arithmetic independently traced; new video parity unverified | `c488943` |
| Viewmodel on shot | Fresh native clips independently compared; procedural share requires rendered landmarks | Clip timing retained; .22 procedural recoil share remains; R8 mount corrected in pass19 | Matched sampled clip data; procedural movement unverified | `9b94483` |
| Muzzle flash / tracer onset | Native clip event tracks and tracer data; see animation/combat inventories | Simulated shot triggers pooled flash/tracer; native cadence option retained | Approximated particles and renderer timing | `c488943` |
| Viewmodel offsets / presets | Fresh configured native FOV65, offsets−.5/1/−2 | Source-unit conversion gives metres−.0127/−.0508/−.0254; presets unchanged | Matched coordinate arithmetic; complete placement unverified | `c488943` |
| FOV / stretched view | Native configured viewmodel FOV65 | Vertical projection51.077193°; world4:3 and16:9 flow to model aspect; unchanged | Trainer arithmetic measured; matched native image comparison unverified | `c488943` |
| Crouch camera | Fresh native view/root offset samples, movement inventory | Smoothstep replaced by independently approaching90u/s offsets | Matched recorded server state; rendered interpolation unverified | `79832e6` |
| Landing camera / weapon dip | Native demo state available; complete rendered trajectory not recovered from gapped video | Existing view-punch response and model landing adjustment retained | Unverified rendered amplitude and duration | `c488943` |
| Head bob / sway | Fresh view graphs contain no movement-driven nodes in searched selection | No deliberate locomotion bob; unchanged | Complete native absence unverified; code outside graph may move the model | `c488943` |
| Hit sounds / damage indicators | Native hit/hurt event assets and mixer metadata; fresh sound onset alignment not captured | Head/helmet/body/armor and shooter/victim event selection; training indicators and damage camera retained | Native asset selection supported; timing/loudness and UI parity approximated | `c488943` |
| Kill confirmation | Native event/UI rendering not frame-compared | Trainer kill feed/count and target feedback follow simulated death | Approximated training feedback | `c488943` |
| Blood / bot flinch | Fresh native flinch clips and flags; animation inventory | Imported bullet-hit deltas plus simplified blood particles; unchanged | Matched sampled clips; approximated effects/blends | `c488943` |
| Footstep cadence | Current-server instructions and command-producer emulation establish pre-movement timer, speed gate and ordinary64Hz cadence; [full ledger](reaudit-footsteps.md) | Distance accumulator replaced: both engines AK242.1875–250→406.25ms, AWP265.625–273.4375→406.25ms, knife210.9375–218.75→312.5ms | Matched ordinary flat dry-ground timer; special states, exact edge quantization and audible onset remain partial | Pass21, pending commit |
| Footstep loudness / stance | Native scalar volume/duck multiplier and current soundevent metadata inspected; no calibrated source loudness or listener-distance sweep | Walk/crouch probes emit0steps under the verified gate; browser spatial mixer unchanged | Normal-ground gate matched; complete loudness, occlusion and every special stance unverified | Pass21 gate; existing mixer retained |
| Weapon sound timing / distance layers | Fresh native action timelines/mixer imports and clip event metadata | Imported gun/action events, distant layer and browser spatial gain; unchanged | Matched imported data; runtime spatial mix/occlusion approximated | `c488943` |
| Bot target locomotion / turning / landing / death | Fresh world clips/graphs, pose/capsule bench | Native clips in custom blends; missing turn/planted/additive states; custom ragdoll | See full animation inventory; overall approximated | `c488943` |

No new response constant was fitted to an unvalidated video/audio signal. Exact
remaining evidence: high-rate game-only capture with reliable decoded timestamps
and synchronized input edges; controlled constant-speed sound runs at multiple
weapon caps, surfaces and listener distances; matched native/trainer camera and
gun landmarks through fire, recovery, crouch, landing and zoom; native client
footstep delivery/special-state paths and animation-update readers after bridge
analysis completes. Normal-ground timer/command cadence is now established in
the separate footstep ledger; no sound-mix constant was fitted to these captures.

## Recorder diagnosis

`tools/reaudit-capture-pts.py <video> <report.json>` enumerates decoded PTS.
The original recovery capture has 44 decoded frames from 0 to 14.067 s, including
a 3.8 s maximum gap. `tools/reaudit-recorder.py --mode video|combined|separate
--output <new.mkv>` creates its own 640×360 X11 window and, for audio modes,
requires an idle output monitor; it never captures the desktop or microphone.
Run with DISPLAY/XAUTHORITY and the same resource cap. An eight-second test
retained 480 video frames (maximum 17 ms gap) without PulseAudio in the video
process. Combined capture retained 9 frames with a 4.017 s gap; bounded audio
fragment/probe tuning still retained only 124 frames with a 2.05 s gap. Separate
video/audio processes retained 480 video frames with no gap over 50 ms.
`tools/reaudit-capture.py` (also reached through the existing
`native-audit/run-capture.py` entry point) now verifies the CS2 window identity and exact
size before capture, and records optional output audio as a separate WAV.
Process launch clocks are retained as approximate alignment; no sample-exact
AV synchronization is claimed. Existing native demo measurements are unaffected.

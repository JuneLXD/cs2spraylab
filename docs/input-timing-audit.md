# Input timing and handling

The browser engines now share one monotonic clock between input events and
animation frames. Keyboard/button transitions first consume elapsed time with
the previous held state, then apply the new state at that time. Ordinary mouse
motion advances only due simulation boundaries, so an 8 kHz mouse does not run
8,000 physics steps per second. Older rAF timestamps cannot count input time
twice. Entry/resume resets the clock; long stalls retain the existing 250 ms cap.

The movement grid remains 128 Hz. Input edges and pending weapon deadlines can
split a grid interval. Early clicks no longer run a future tick or create a
negative accumulator. Full-auto and burst deadlines split simulation time so
movement, accuracy and recoil are sampled at the firing deadline. Existing
trigger buffering, weapon data, spread, recovery constants and cooldowns remain
in force. This is event-timed offline simulation, not Valve's subtick engine.

The local camera predicts the remaining interval with the same movement,
terrain and actor collision solver. Prediction does not mutate combat or RNG.
Bots retain smooth interpolation; timestamped history handles partial intervals.
Only frames actually submitted by the Duel renderer become the target poses for
player shots. Live health, armor, alive state and generation remain authoritative,
as does world cover. Bot shots and headless callers without a displayed frame
use current geometry. Range moving-target shots retain the last displayed mesh
pose within the same drill. No simulated ping or configurable rewind is added.

First-person animation updates every rendered frame, independently of the
world-model animation budget. Physics no longer waits for the graphics frame
cap. Raw pointer lock and the desynchronized canvas remain enabled as before.

The requested profile already matches first-visit defaults: 800 DPI,
sensitivity 1, zoom ratio 1, 1920×1440 stretched. Saved profiles are preserved.
At the existing 0.022 degrees/count mapping, that is approximately 51.95 cm/360.

## Validation boundaries

Regression fixtures exercise sub-tick clicks and short strafes; event ordering;
60/144/240/360/500 Hz frame schedules; 8 kHz mouse events; read-only collision
prediction; displayed-target hits; respawn isolation; live armor/cover; and exact
fractional weapon cadence. These establish internal behavior, not measured
mouse-to-photon latency on the user's PC.

Native recoil camera/viewmodel fractions remain estimates (0.45 and 0.22).
The local agent resource contains ragdoll PHYS capsules but no independently
verified gameplay hitbox mapping. Ragdoll shapes are not substituted for bullet
hitboxes. Complete animated native hitboxes, current-build camera reconstruction,
and side-by-side CS2 captures remain separate fidelity work. Existing recoil and
movement audit evidence is preserved; no new exact-CS2 claim is made.

## Completed checks

- Production TypeScript/Vite build passed.
- Full unit suite: 2,014 passed; one pre-existing failure requires the absent
  `public/models/ak47.json` fallback asset. The final focused check passed all
  49 timing, engine, equipment, pickup and changelog tests.
- Chromium: all six input-timing and hit-latency cases passed, plus native
  pointer capture and mouse-only aiming across Duel → Escape → Guided.
- All Node checks used MemoryMax=8G and MemorySwapMax=0. Browser runs also used
  CPUQuota=400%, one suite at a time. Software WebGL on this host is unsuitable
  for claiming latency or GPU performance gains on the user's RTX 4090.
- The existing all-interface preview served both the page and new input module
  through `http://192.168.0.18:5190`.

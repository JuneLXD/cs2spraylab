# Reload clock verification, installed build 2000927

The previous model doubled the entire reload immediately while R was held.
This change follows the installed gate and authored silent sections instead.

`docs/native-silent-reload-gate.json` retains offline execution of client
function `0x148b5b0`, binary SHA-256
`99ae5b5724e869de64cc810d7ade089fb18d2fe08dcb8d88982af39f951d1d12`.
Owner, input and clock helpers were shimmed; attack deadlines were expired.
The experiment verifies gate eligibility, hold timer, silent flag and selected
playback rate. It does not independently execute deadline rescaling.
The executable harness remains at `../native-audit/emulate-silent-reload.py`.

The native gate requires reload held continuously from its start. On entering
an authored silent section, it waits 200 ms before selecting 0.5 playback speed.
Leaving the section or releasing R restores 0.99 speed after a slow section;
a reload that never slowed remains at 1. Releasing R permanently disqualifies
that reload from later silent activation. Subsequent presses cannot re-enable it.

`tools/import-reload-timing.mjs ../native-audit/reload-resources` imports the
freshly decoded installed clips, using `tools/read-native-clip-timing.py` and the
existing local Source Tools DMX parser. `native-reload-timing.json` records hashes,
43 normal/empty clips across 34 weapons, ADD_AMMO markers and silent sections.
Magazine insertions use those markers without changing the separate vdata
attack-ready duration. Missing empty clips use the normal clip.

`ReloadClock` separates wall time from animation work and splits at gate,
section, insertion and completion boundaries. Progress drives first-person
animation, opponent reload gestures and foley cues. This fixes the opponent
magazine gesture freezing while the extended wall deadline exceeded clip length.
Audio stays suppressed during silence and resumes from current progress without
replaying earlier cues.

Fresh offline CS2 recording `native_reload_gate_001.dem` tests the actual input
branches. Its hash, edges and observations are in `native-reload-gate-live.json`.
The new continuous clock predicts all insertion/end times within two 64 Hz demo
samples (31.25 ms); frame polling and the sampled reload start limit precision.

| M4A4 input | Native insert | Trainer insert | Native end | Trainer end |
| --- | ---: | ---: | ---: | ---: |
| Tap then hold | 1.375 s | 1.367 s | 3.078 s | 3.067 s |
| Hold 1 s, release, hold again | 1.766 s | 1.774 s | 3.484 s | 3.492 s |
| Keep held | 2.516 s | 2.533 s | 4.938 s | 4.943 s |

This is evidence for the measured M4 branches and the installed gate, not a
claim that every weapon has been recorded. The remaining magazine markers are
static installed-file evidence. Shell weapons retain the estimated start/finish
and per-shell gameplay phases; their authored silent sections are mapped into
those phases as their animations already are. Exact native shell sequencing,
full Source 2 animation graphs, IK and shaders remain outside the verified model.

The user's Chrome/4090 aim_redline check reported stable 500 FPS and 2.1 ms frame
time, including firing. This is a user-reported browser measurement, not captured
physical input latency or proof of zero compositor/display delay. It supports
retaining the current rendering path while prioritizing gameplay presentation.

Additional live capture `native_reload_deagle_empty_002.dem` confirms the
normal Desert Eagle insert at 0.765625 s and empty insert at 1.03125 s, matching
frames 23/30 and 31/30 respectively within one demo sample. See
`native-empty-reload-live.json`. The first attempt is excluded because parsed
weapon identity identified an M4A4; the second was visually and programmatically
verified as Desert Eagle before its measurements were accepted.

## Validation

- Full regression run: 2,117 passed; five CPU-heavy simulation cases timed out
  while native CS2 was running, and one known baseline asset test failed because
  the original archive lacks `public/models/ak47.json`.
- After closing CS2, both affected simulation files pass with one worker: 30/30.
  Final native reload/gate/changelog checks pass: 36/36, including the newly
  recorded Deagle empty branch. The prior six-file focused run passed 93/93.
- Five Chrome integration checks pass: held/normal first-person reload pose,
  new-weapon firing/reload/recharge, spatial audio, projected tracers and exported
  frame diagnostics. No repository edits occurred during the browser suite.
- TypeScript and the production build pass. A fresh visit through
  `http://192.168.0.18:5190` loads aim_redline and fires with zero page errors or
  failed asset responses. Native recordings and fixtures load through the
  comparison page at `http://192.168.0.18:5191`.
- Logs and full recordings remain in `../native-audit/reports/`; the native
  client and its temporary idle inhibitor were closed after capture. Changes
  are local; this work did not publish a new public release.

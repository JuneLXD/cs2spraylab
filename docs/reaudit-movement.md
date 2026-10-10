# Movement re-audit, baseline c488943

The fresh native capture overturned three movement assumptions: standing and
crouched jumps have different launch speeds; an airborne stance change moves
the collision origin nine units; crouch camera offsets approach their targets
at 90 units/s instead of following a smoothstep of duck amount. These are fixed
in the shared motor and propagated through the range simulation. No ground
acceleration, friction, walking speed or air-acceleration constants were tuned.

This report distinguishes native server state from a rendered camera. Recorded
camera-service offsets establish the crouch state arithmetic, but do not alone
certify the client's final rendered/interpolated camera. Terrain collision is
still an approximation.

## Reproduction and evidence

All Node commands below require the machine's prefix:
`systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0`.

- `node tools/reaudit-movement.mjs <output.json>` records per-step trainer
  position, velocity, stance, eye height, launch/apex/landing, both dt values,
  every weapon's speed, air acceleration and the jump gates. Baseline and fixed
  results: `../native-audit/reports/reaudit-movement-{before,after}.json`.
- `python3 tools/reaudit-movement-native.py native_reaudit_airduck_003
  --write-fixture` parses the actual demo and regenerates
  `src/range/native-movement-reaudit-fixture.json`. The vendored parser is used;
  no game is launched. Sanitized native state is retained as
  `../native-audit/reports/native_reaudit_airduck_003/movement-ticks.{csv,json}`.
- `npx vitest run src/range/native-movement-reaudit.test.ts` replays all four
  recorded camera transitions, four launch observations and three airborne
  origin changes. Before: 1 passed / 10 failed. After: 11 passed / 0 failed.
  The camera checks retain every sample, not only the final pose.

Evidence labels used below:

| Label | Primary evidence and boundary |
|---|---|
| M1 | Current `libserver.so`, SHA-256 `c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`; matching active REA session saved as `../native-audit/rea/out/reaudit-movement-session.json`. Re-read saved Friction, Accelerate, WalkMove, AirAccelerate, AirMove, modern Jump, Duck and DoMovement pseudocode. This is static evidence, not observed execution. |
| M2 | Freshly queried FinishDuck, FinishUnDuck and CanUnDuck from that session before the host reboot. Raw decompiles are retained under `../native-audit/rea/out/reaudit-movement-*.c`. They show immediate airborne completion, half-hull-height origin shifts and an occupancy trace for standing. |
| M3 | Approved fresh `native_reaudit_airduck_003.dem`, SHA-256 `b2e4254179264568f323339cb87b22d1217b9447c88b4a419fb75b9d88e0ceb8`. Stationary standing jump, fully crouched jump, midair crouch, midair crouch/release. Settled floor 116.0314 units; no horizontal displacement. The first falling setup segment is excluded. |
| M4 | Fresh runtime console queries in `../native-audit/reports/reaudit-20261009/native-console-initial.txt`: acceleration 5.5, friction 5.2, stopspeed 80, air acceleration 12, wish cap 30, gravity 800, jump impulse 301.99338, modern jump enabled, bhop window 0.0078125, spam threshold 0.015625, duck cooldown 0.4, ladder scale 0.78, normals 0.7, subtick movement angles true. These are observed configured values, not claims about immutable defaults. |
| M5 | Retained `native_audit_ak_002.dem` / its position CSV: release edges 2800 and 2900; reversal 3107. Position-interval speed crosses 34% at 203.125 ms for release and 78.125 ms for reversal. Parser velocity aliases are one interval later. These are 64 Hz interval averages, not direct subtick velocity or exact physical key timing. |
| M6 | Fresh Source2Viewer `weapons.vdata` export at `../native-audit/reports/reaudit-combat/weapons.vdata`. The combat re-audit compares all 35 weapon records in both modes with zero stat mismatches; the knife record independently contains max speed `[250,250]`. |

## Inventory

“Matched” is bounded by the evidence described in its row. “Approximated” means
the trainer implements the behavior but complete native agreement is not
established. Changed movement rows are implemented in commit `79832e6`; unchanged
rows identify the audited baseline `c488943`. Delivery validation is recorded
in the coordinating report.

| Mechanic | Game rule / evidence | Trainer before | Trainer after | Status | Implementation commit |
|---|---|---|---|---|---|
| Ground acceleration | M1 Accelerate separates wish speed and acceleration speed; base max(250,wish), weapon/stance scales, 5 u/s walk taper. M4 acceleration 5.5. | Same arithmetic; AK rest→215 u/s at 570.3125 ms. | Unchanged. | Matched equations; complete live acceleration trajectory still approximated. | `c488943` |
| Ground friction / stop speed | M1 ground-only max(speed,80)×5.2×surface×dt, midpoint movement correction. M4 numeric values. | Default surface=1 behavior matches; surface-specific friction metadata is not consumed by actor motor. | Unchanged. | Matched default-surface equation; variable surfaces approximated. | `c488943` |
| Counter-strafe / release | M5 position intervals; M1 friction/acceleration. | 34% threshold 78.125 / 203.125 ms; sustained reverse crosses zero 125 ms, release zero 382.8125 ms. | Unchanged. | Matched sampled threshold only; exact subtick stop timing unverified. | `c488943` |
| Stand / walk / crouch caps | M1 running weapon cap, walk×0.52, crouch×(1−0.66 amount). | AK215 /111.8 /73.1 u/s; ground speed clamps every step. | Unchanged. | Matched equations. | `c488943` |
| Weapon speed multipliers | M6 all 35 firearms, both modes; knife250. | Extracted speeds; bench enumerates all 71 supported weapon/mode entries. | Unchanged. | Matched data. | `c488943` |
| Scoped walk acceleration | M1 second zoom with scaled walk speed<110 retains weapon scaling. | Implemented;100 u/s weapon gives4.296875 u/s gain/128 step from rest. | Unchanged. | Matched static branch. | `c488943` |
| Silent walking threshold | Current-server movement wrapper bypasses the timer while walking or below135.2u/s; speed²<10 resets it. See [footstep ledger](reaudit-footsteps.md). | Gate54% weapon speed; distance accumulator. | Native absolute speed/walk gate and rest reset. | Matched bounded ordinary dry-ground cases; special sounds and client delivery remain partial. | `2aba70c` |
| Air acceleration / wish cap | M1 AirAccelerate/AirMove; M4 12/30. Gain budget12×uncapped wish×dt; capped directional deficit; half budget before movement, remainder after. | AK from rest20.15625 u/s gain/128step; pre-move10.078125. | Unchanged. | Matched arithmetic. | `c488943` |
| Air-strafe / no-key control | M1 uses wish direction and dot product; zero wish gives no gain. | No-key momentum retained; directional cap 30; orthogonal strafe can add speed. | Unchanged. | Matched isolated arithmetic; full curved runtime path/collision unverified. | `c488943` |
| Bunny-hop timing | M1 window/restore/clamp branches, M4 7.8125ms full window; velocity restoration gated above weapon cap; launch clamp1.1×weapon unless enabled. | ±3.90625ms; restores only overspeed; AK clamp236.5u/s. | Unchanged. | Static rule matched; runtime boundary presses unverified. | `c488943` |
| Jump spam | M1 modern jump rejection; M4 15.625ms threshold. | ≤15.625ms rejected;15.626ms accepted. | Unchanged. | Static/default matched; rapid physical-input delivery unverified. | `c488943` |
| Jump impulse / standing trajectory | M1 standing branch subtracts gravity/256; M3 records 298.86838 at ticks282,670,873. | Used301.993 for standing; apex 56.9974u. |298.868; apex 55.8255u, matching recorded apex 55.81235u within sampling/position quantization. | Fixed; matched launch state and bounded trajectory. | `79832e6` |
| Fully crouched jump | M3 tick476 launch301.99338. | Full impulse, correct. | Full impulse retained. | Matched launch state. | `c488943` |
| Midair crouch / crouch-jump height | M2 and M3 ticks681/882: amount0→1; ballistic origin residual+9.0078125/+8.9921925u. | Gradual tuck, +18u; midair-crouch apex 74.9974u. | Immediate crouched state,+9u; apex 64.8255u. | Fixed; matched origin change within1/64u quantization. Partially crouched takeoffs remain approximated. | `79832e6` |
| Midair unduck | M2 clearance check; M3 tick894 amount1→0, residual−8.9921875u. | Gradual stand,-18u expansion. | Immediate stand,-9u, still requires standing hull clearance. | Fixed; matched free-space case; constrained-ceiling transitions unverified. | `79832e6` |
| Ground duck / unduck amount | M1 Duck and M3 ticks412–425/542–552: down0.8×duckSpeed, upmax(1.5,duckSpeed). | Fresh-edge completion203.125ms down,164.0625ms up at128Hz. | Unchanged amount arithmetic. | Matched sampled states;128Hz split introduces documented small amount difference. | `c488943` |
| Duck eye-height curve | M3 per-sample DuckViewOffset→−18×amount at 90u/s; DuckRootOffset compensates airborne origin changes and approaches0 at 90u/s. | Smoothstep of duckAmount; ground-unduck sample error up to4.60295u; camera finished164.0625ms. | Both offset states preserved; recorded ground/air sequences match within0.0001u; fully rested camera return203.125ms. | Fixed server eye-offset arithmetic; final client interpolation not yet measured. | `79832e6` |
| Duck fatigue / cooldown | M1 both edges consume2, recharge3/s, extra6/s after64u, thresholds1.5/0.75; M4 cooldown0.4. | Implemented. | Retained; new camera remains independent of amount completion. | Matched bounded static/replayed state; stationary spam edges need exact native command fractions for complete parity. | `c488943` |
| Falling / landing slowdown | M1 modern landing-state dependence and gravity; older arithmetic fixture bounds identified separately. | Ballistic gravity800; ground factor clamp(1+v×.0005,.2,1)² then+1.111189t; jump factor base+0.6t. | Unchanged factors; standing relaunch uses corrected impulse. | Approximated complete collision/landing timing; no legacy stamina claim substituted for modern factors. | `c488943` |
| Post-landing accuracy | Native weapon landing hook is covered by combat re-audit. | Landing-speed×weapon land penalty. | Unchanged. | See combat evidence; no independent runtime accuracy capture claimed here. | `c488943` |
| Landing camera dip | Distinct native view-punch/camera mechanism; M3 carries view-punch state but this worker did not establish rendered dip from it. | Existing landing camera/view-punch response. | Unchanged. | Unverified by this movement pass; see response worker. | `c488943` |
| Step height / stairs | M4 confirms normals; current trainer step18u derives from older fixture/config evidence, not a fresh stair run. | Swept square hull with18u step-up/down. | Unchanged. | Approximated; exact stair trace and camera behavior unverified. | `c488943` |
| Slopes / collisions | M4 standable/walkable normal 0.7; M2 standing occupancy trace. | Authored box/wedge solver and voxelized imported map;32u width,72/54u heights; smooth ground-transition hull. | Air changes corrected; geometry solver unchanged. | Approximated. Surface friction, partial-ground-duck hull, multi-plane clipping and map discretization need native geometry traces. | `c488943` |
| Ladders | Native ladder scale 0.78 (M4); older isolated detach arithmetic270u/s. Authored loft ladders exist in trainer. | Simplified projected wish velocity; incidence/damping branches not completely implemented. | Unchanged. | Approximated; live ascent/dismount/detach trajectory unverified. | `c488943` |
| Subtick press timing / view sampling | M1 DoMovement integrates button-edge fractions and samples view angles when enabled (M4 true). | Both engines flush old-input elapsed time before applying edges; 128Hz base slices. | Unchanged. | Matched scheduling design; not proof that128Hz integration equals every native subinterval. | `c488943` |
| Native tick mapping | M3 jump timestamp53736+.53125 corresponds419.816650s at128Hz; demo282 time419.828125s. | Trainer base128Hz; event schedules also use64Hz server boundaries elsewhere. | Unchanged; documentation distinguishes clocks. | Matched observed mapping for movement timestamp fields; other tick fields must be identified individually. | `c488943` |

## Claims corrected and remaining measurements

- A single301.993 u/s jump impulse did not describe standing launch state.
  Three fresh standing jumps record 298.86838; the crouched launch records 301.99338.
- The old shared collision test asserted that crouch raised airborne feet 18u
  while preserving eye height throughout the jump. Native hull shift is9u;
  origin compensation preserves camera continuity initially, then the eye
  settles9u lower relative to the standing ballistic trajectory.
- Smoothstep was an unverified camera assumption. Fresh ground-unduck data
  shows amount0 at tick552 while eye offset remains−2.61914u, reaching0 only at554.
- Nominal6.4/s down and8/s up are maximum rates, not fresh-key duration claims:
  input edges consume duck speed. The old duration exports remain rate helpers.
- “128Hz matches CS2 subtick” was too broad. Native button fractions determine
  integration boundaries;128Hz is also used by the observed jump timestamp
  representation. Demo sampling and held-fire boundaries remain separate 64Hz
  clocks. Agreement of endpoints does not prove identical integration.
- Fresh `native_reaudit_movement_001` lateral runs change floorZ by up to ~1.5u
  and later encounter obstructed travel. They are unsuitable for retuning flat
  acceleration or stopping constants; the stationary crouch portions remain useful.

Remaining exact evidence: flat isolated native input/position trajectories for
all stance/weapon transitions; high-frequency jump presses centered on measured
landing fractions; constrained airborne unduck and partly crouched takeoffs;
matched stair/ramp/ladder geometry traces; rendered camera frames synchronized
to duck state; native footstep delivery/audio beyond the ordinary timer established in pass21. These are explicitly
open, and no speculative feel tuning was shipped for them.

Pre-commit edge review also reproduced one introduced integration bug: a
one-unit floor-penetration repair created a negative one-unit duck root offset
even without a stance change. Root compensation now excludes the floor repair
and applies only to airborne stance displacement. The regression failed before
the correction and passes afterward. Additional checks cover blocked airborne
unduck, camera recovery through landing, immediate landing/bounce, and both
range pose reset paths; their native-behavior scope remains bounded as above.

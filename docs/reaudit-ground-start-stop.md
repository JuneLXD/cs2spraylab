# Initial acceleration, stopping and command segments — pass 47

The live trainer starts more slowly than the guarded native replay under the
same supplied ordinary movement conditions. The held friction correction fixes
the initial speed deficit, but its 128 Hz subdivisions still produce different
stopping and reversal trajectories. Giving the actual actor, Range and Duel
the native command segments instead makes all 84 completed comparisons match
within SI conversion error. This is an investigation result, not a shipped
change or justification to change every simulation system to 64 Hz.

Main/live remain `e99fd05`. The broader movement branch remains held. The separate
`f230edd` scoped-walking delivery is unchanged and still awaits its own approval.
No production source or asset changed in this pass.

## What was compared

The current server hash is
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
The existing guarded instruction oracle was extended with 21 curves: seven
priority weapons, standing/walking/fully crouched, starting from rest, holding
input, releasing, restarting, then pressing the opposite direction. Seven
crouched curves were separately extended to two seconds to reach full speed.
Both directions of the reversal are simulated cumulatively; endpoints are
never copied from native output into the trainer.

These runs execute the same hash-verified native friction, acceleration,
cap/work and stop slices as passes 44–45. Weapon getter speeds, processed
stance caps, dry flat ground, command times and input are supplied. Collision,
the entire native command dispatcher, physical key delivery, client prediction
and display latency are outside the comparison. In particular, crouch results
start fully crouched; they do not measure the stance transition.

The native command cases use one movement segment per 1/64 s command, with
the oracle's saved-fraction insertion rules still active. Earlier executed
native producer evidence returned `[1]` for unchanged input and inserted actual
supplied input edges; the CS override separately inserts an active friction
fraction. There is no unconditional half-tick split in that supplied producer
case. Its zero-initialized fixture has no weapon or active cache, so it alone
does not prove every moving-AWP command's segment list.

The trainer was measured three ways: live code at its usual 128 Hz; held code
at 128 Hz; and held code given the native segment durations as a diagnostic.
Each uses the real shared actor, Range and full Duel implementations. Those
three implementations agree independently for each fixed-rate comparison.

## Starting from rest

All times below are **first observations on a shared 15.625 ms grid**. They are
not exact sub-command threshold crossings or key-to-screen latency. The live
trainer still takes two 7.8125 ms steps between these observations.

| Running weapon | Speed after 15.625 ms: native / live (u/s) | First observed 99% speed: native / live |
| --- | ---: | ---: |
| AK-47 | 18.48 / 15.23 | 531.25 / 546.875 ms |
| M4A4 / M4A1-S | 19.34 / 16.09 | 531.25 / 546.875 ms |
| AWP, unscoped | 17.19 / 13.94 | 531.25 / 546.875 ms |
| Glock / USP-S | 20.63 / 17.38 | 531.25 / 546.875 ms |
| Deagle | 19.77 / 16.52 | 531.25 / 546.875 ms |

For AK walking, the first observation is 11.17 native versus 7.92 live u/s;
99% walking speed is first observed at 390.625 versus 406.25 ms. For the fully
crouched AK fixture, it is 7.30 versus 4.05 u/s initially, and 1,281.25 versus
1,343.75 ms to the first observed 99% crouch speed. The ledger includes all
weapon/stance metrics, including the longer crouched cases.

The initial deficit has a concrete source: live code recomputes friction
from the velocity gained in its first half-step. Native friction state retains
the command's zero starting control speed in this fixture. The extra live
half-step friction removes 3.25 u/s before the first command ends. This is
different from adding a fixed input-delay constant. The held stateful correction
matches the initial native speed and the listed running-start milestones.

## Release, standstill and counter-strafing

The earlier approximately 203 ms figure refers to **zero movement contribution
to inaccuracy**, not zero velocity. Other spread/inaccuracy components remain.
Under these supplied running releases, native movement contribution reaches
zero at the 203.125 ms observation for all seven weapons; complete standstill
is later and depends on weapon speed:

| Running weapon | First observed zero velocity: native / live |
| --- | ---: |
| AWP, unscoped | 359.375 / 375 ms |
| AK-47 | 375 / 390.625 ms |
| M4A4 / M4A1-S | 390.625 / 390.625 ms |
| Deagle | 390.625 / 406.25 ms |
| Glock / USP-S | 406.25 / 406.25 ms |

M4/Deagle/Glock/USP movement inaccuracy reaches zero at the 218.75 ms live
observation here. The earlier 210.9375 ms result used finer half-step sampling;
it is consistent with this coarser table and must not be replaced by a claimed
218.75 ms exact crossing. Native and live running counter-input first reach
zero movement contribution at the common 78.125 ms observation in these cases.
That milestone matching does not establish equality of the entire reversal.

The held arithmetic also needs correct segment integration. For example, held
128 Hz M4 release reaches complete zero at 375 ms, earlier than native's
390.625 ms observation. Its AK reversal reaches 99% speed in the opposite
direction at 656.25 ms versus native 640.625 ms. Changing acceleration or
friction constants to fit either result would mask the scheduling difference.

| Completed primary comparison | Cases / observed rows | Maximum velocity error | Maximum derived position error |
| --- | ---: | ---: | ---: |
| Live 128 Hz versus native commands | 63 / 11,088 | 7.40001 u/s | 5.32855 units |
| Held 128 Hz versus native commands | 63 / 11,088 | 8.83084 u/s | 2.43396 units |
| Held with matched native segments | 63 / 11,088 | 2.85×10⁻¹⁴ u/s | 2.56×10⁻¹³ units |
| Longer crouch, held with matched segments | 21 / 5,040 | 1.43×10⁻¹⁴ u/s | 1.85×10⁻¹³ units |

All 63 fixed-rate cases have at least one trajectory disagreement. The held
code improves some results and worsens the maximum velocity difference; it
is not ready to ship based on arithmetic matching alone. Positions are derived
uncollided displacements, not a native collision/publishing replay.

## AWP rescope: new discriminating evidence

Twelve new guarded native cases supply the previous moving velocity and the
new scoped cap, covering both zooms and running/walking. Only duration varies:

| Supplied movement duration | Running 200→100 cap: native endpoint | Walking 104→52 cap: native endpoint |
| --- | ---: | ---: |
| 3.90625 ms | approximately 100 u/s | 52 u/s |
| 7.8125 ms | **0 u/s** | **0 u/s** |
| 15.625 ms | approximately 100 u/s | 52 u/s |

Both zooms give the same result. The native stop predicate projects the
segment's accumulated acceleration using a fixed 1/64-second term and the
current segment duration (`1/64 - dt/2`); the half-command cap
reduction projects near zero, while quarter/full-command cases do not.
This establishes duration sensitivity in native execution, rather than only
an authored algebra explanation. It does not prove which duration a real
moving-rescope command produces.

Retained producer instructions place weapon deadlines in the remaining-event
list and saved friction fractions in the movement list. The previously bound
caller completes movement before those remaining weapon events. This narrows
the required integration: preserve native movement segments and cap sampling
across trainer updates, including input changes and subsequent accuracy use.
Simply reordering Range rescope, pre-clamping velocity, adding a delay, or
changing the global simulation rate is not established by these observations.

A bounded 640-byte retained-prefix decode also examined the outstanding early
preparation helper. With the supplied zero service scalar and valid pawn, it
returns unchanged or decays another scalar; it does not clamp velocity. The
positive-scalar branch and outgoing paths remain incomplete. This closes that
specific generic-pre-clamp hypothesis, not all movement callbacks.

## Validation, reproduction and remaining work

The [compact ledger](evidence/reaudit-ground-start-stop.json) pins completed
reports, native execution-content digests, all bundled application sources,
metrics and limits. The source verifier passes, as do the matched-segment
comparison assertions. New tools are:

- `tools/reaudit-ground-start-stop-native.py`: `--binary`, `--schedule command`,
  `--output`; add `--stance crouch --start-commands 128` for the longer cases.
- `tools/reaudit-ground-start-stop-trainer.mjs`: `--repo`, `--native`,
  `--native-sha`, `--output`; `--trainer-half-steps` measures the normal caller
  rate, while `--expect-match` asserts the matched-segment diagnostic.
- `tools/reaudit-ground-cap-duration.py`: `--binary`, `--output`.
- `tools/reaudit-ground-preparation-prefix.py`: `--span`, `--provenance`, `--output`.
- `tools/reaudit-ground-start-stop-summary.py`: `--reports`, `--output`.

Raw outputs and exact earlier reader versions remain in
`../native-audit/reports/ground-start-stop-20261010`. Reader/metadata changes can
change full output hashes; canonical native execution digests pin the fixtures,
results, hooks and guards independently. Existing frozen native dependencies
were not edited. No full application suite or browser was rerun because
production code did not change; these are actual-engine investigation probes.

All execution was serial under 512 MiB, zero swap and one CPU, with deployment
inactive and at least 12 GiB available at launch. Two expanded native sweeps hit
their own cgroup cap; kernel logs identify scope-only OOM and earlyoom recorded
no production kill. Partial outputs are excluded. The completed reference runs
use smaller case sets; future half-segment runs require one explicit fixture
per process, and the tool rejects oversized command batches. No cap was raised,
game launched, full analysis restarted, or deployment performed.

Next implementation work is native command/segment association in the movement
integrator, followed by actual input changes, prediction immutability, collision,
scope transitions, and shots at/between boundaries. A clean live native trace is
still needed to establish physical input and moving-rescope behavior. The
existing fixed-state proofs remain valid within their supplied schedules.

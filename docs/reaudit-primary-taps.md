# Common-weapon early primary taps

The current trainer's ordinary early-trigger behavior agrees with the native
branches checked here. No timing constant or click buffer needs changing.
Across AK-47, M4A4, M4A1-S, AWP, Glock, USP-S and Deagle, all 56 actual-engine
scenarios match the expected released/held behavior; all 28 Range/Duel pairs
agree on shot count, exact schedule and processing time.

Current-server code first tests active primary input and readiness. A held
request is checked again when ready. Fully inactive input cannot dispatch a
shot. A positive semiautomatic shot counter rejects continued held firing;
ordinary idle clears that counter before checking readiness, allowing release
and re-arm during cooldown. Earlier secondary/reload branches can prevent idle,
and pending burst continuation is separate.

The native active-input predicate also checks transition state. Therefore,
“physical mouse release means no native shot” is broader than this evidence.
The producer/reset lifetime of those masks and same-command press/release
aggregation remain unverified. The trainer bench supplies distinct ordinary
press/release boundaries; it is not a native mouse-input trace.

The native evidence uses current server SHA-256
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`,
seven concrete weapon classes, 59 instruction assertions and 28 new virtual
slot checks. A bounded read adds 2,896 bytes to retained common-reload evidence.
The checker derives eight mask cases and sixteen ordinary dispatch cases;
none is presented as native execution. Retained REA idle-body evidence is
`ev_3984277cdc5e6eaea0d48afb7bad05ebfa33f077c6ca2a6956ad7cbfaaa99311`.

Reproduce the primary evidence using
[`tools/reaudit-primary-native/README.md`](../tools/reaudit-primary-native/README.md)
and the actual trainer measurement with `tools/reaudit-primary-taps.mjs`.
Baseline results are retained at
`native-audit/reports/core-shooting-next/primary-taps-baseline.json` in the parent
workspace and committed as
[`evidence/reaudit-primary-taps-trainer.json.gz`](evidence/reaudit-primary-taps-trainer.json.gz).
The [native proof](evidence/reaudit-primary-taps-native.json) is also committed.
The packaged reader and checker reproduce all 59 assertions, 28 fresh slots
and 24 derived cases without changing the original reports.
Each scenario records every 128 Hz step and distinguishes scheduled
shot time from callback time. Readiness checks are repeated at existing 64 Hz
boundaries; no claim of physical input latency follows.

The smallest remaining native measurement is a near-deadline press/release
on a common pistol and rifle, observing transition masks, command invocation
and shot outcome together. Separate within-command taps from releases spanning
commands. A fitted buffer delay would not resolve that missing evidence.

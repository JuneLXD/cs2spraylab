# Common-weapon reload admission

The trainer previously started an explicit reload during the preceding shot's
firing cycle. The correction makes an early released R tap expire and a held R
retry once the weapon is ready, respecting attack priority. The current native
server proves this admission rule for AK-47, M4A4, M4A1-S, AWP, Glock, USP-S and
Desert Eagle.

## Paired engine measurements

[Portable engine comparison](evidence/reaudit-common-reload-engines.json)
retains 56 paired before/after cases across the actual Range and Duel engines.
Each engine gives the same results below. Time is seconds after a shot at zero;
early R is pressed at 0.03125 seconds. An early tap releases at 0.046875 seconds.

| Weapon | Configured cycle | Early tap before → after | Held R before → after | Ready tap/held before = after |
| --- | ---: | --- | --- | ---: |
| AK-47 | 0.100 | 0.03125 → none | 0.03125 → 0.1015625 | 0.1015625 |
| M4A4 | 0.090 | 0.03125 → none | 0.03125 → 0.09375 | 0.09375 |
| M4A1-S | 0.100 | 0.03125 → none | 0.03125 → 0.1015625 | 0.1015625 |
| AWP | 1.455 | 0.03125 → none | 0.03125 → 1.4609375 | 1.4609375 |
| Glock | 0.150 | 0.03125 → none | 0.03125 → 0.15625 | 0.15625 |
| USP-S | 0.170 | 0.03125 → none | 0.03125 → 0.171875 | 0.171875 |
| Desert Eagle | 0.225 | 0.03125 → none | 0.03125 → 0.2265625 | 0.2265625 |

“None” means no reload during the eight-second case. All 14 early taps now
expire, all 14 early holds wait for readiness, and all 28 ready-input controls
are unchanged. Held-start values are the first eligible **128 Hz trainer
updates**, not measured native per-tick start times. Separate whole-engine unit
tests exercise exact-deadline input, held primary, eligible/unready secondary
and pending Glock burst boundaries. The three focused suites passed 150 tests;
this is not a claim of full-suite, browser or deployment validation.

The original reports remain at
`native-audit/reports/reaudit-common-reload/trainer-{before,after}.json`.
Their harness hashes differ only because the portable copy changes two default
paths; both runs pass explicit output paths. The comparison checks that every
remaining harness byte is identical and preserves both hashes, a normalized
body hash, bundle hashes and measured source hashes. These reload measurements
predate the separate duck-flag integration; their hashes identify the isolated
measured versions, not the final release tree.

## Native evidence

[Portable evidence](evidence/reaudit-common-reload-native.json) binds the current
server SHA-256
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
The proof checks 102 instructions and 63 virtual bindings across the seven
concrete weapon classes. It reads 6,502 explicit code bytes and searches one
192 KiB weapon RTTI/table neighborhood. It executes no native code.

All seven classes use the ordinary gun post-frame and magazine reload path.
AWP does not override this path to bypass readiness. For finite normalized
tick/fraction pairs, readiness is **current time >= next-primary deadline**,
including equality. Current time uses the weapon's simulation time domain and
the current fractional tick, rather than wall or video time.

The input dispatcher checks actions in this order:

1. Eligible primary input takes the branch before the semiautomatic shot gate.
   It prevents reload even if that gate rejects the shot.
2. Eligible secondary/alternate input takes priority over reload, including an
   action that ultimately does nothing. A secondary input whose own deadline
   has not elapsed does not independently block reload.
3. Explicit reload requires no active reload and primary readiness. A held R
   remains eligible for retry on later updates; an early failed readiness
   check does not create a persistent reload request.

The ordinary wrapper processes a due pending Glock burst shot before this
dispatcher. Reload must therefore use the deadline after that shot, including
the final burst round's cycle. Automatic AWP rescope is also processed before
the shared dispatcher and does not remove the reload gate.

## Correction boundary

The supported correction is an explicit reload-after-shot gate and held-R
retry for these seven weapons. A retry must respect eligible primary and
secondary input and pending burst order. An early tap released before readiness
must not become a remembered reload request. Other weapons retain their
existing behavior.

This does not establish a new independent player/equip/deploy gate. Complete
upstream admission, transition-mask lifetime for press/release within one native
command, and full burst/reload runtime timing remain outside the proof.
Automatic reload, silent playback, ammo insertion and reload completion are
separate behaviors. The measured correction does not establish complete native
input association or every upstream admission rule.

## Reproduce

From the repository root, with the matching installed server and the existing
`native-audit/python` Capstone/pyelftools dependencies:

```sh
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-common-reload-native.py
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-common-reload-proof.py --portable-report docs/evidence/reaudit-common-reload-native.json
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-common-reload-compare.py
```

The tools resolve the default native-audit directory from their own location.
`--native-root`, reader `--server`/`--out`, and checker `--input`/`--out` overrides
support another local layout. Raw locations remain in tools and local artifacts.
The comparison reads retained engine runs; it does not run Node or the game.

## Final integration

Both actual-input Chromium checks pass: AWP early-tap/held-R behavior and AK held-trigger continuity.
The combined TypeScript/unit/browser results and remaining missing-model fixture
are recorded in the [audit inventory](cs2-reaudit.md).

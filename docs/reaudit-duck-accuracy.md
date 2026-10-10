# Crouch transition accuracy

The range and duel engines selected crouch accuracy at 95% duck amount. Native
CS2 uses a separate pawn flag: it sets on completed crouch and remains set during
successful ground uncrouching until the amount reaches 75% or below. The flag
selects both the grounded accuracy baseline and its recovery time.

The shared motor now carries that flag through movement. Both engines use it
for active and holstered weapon recovery and clear it with a standing pose
reset. Camera, collision and movement-speed calculations retain duck amount.

The original stationary capture has five samples that contradict the old
predicate. On the downward transition, tick 424 has amount 0.98428404 with the
flag clear. On release, ticks 542/543 have amount 0.91146564/0.8162966 with the
flag still set, although the movement service's `m_bDucked` is already false.
Two later release samples repeat that distinction. The native field and amount
are therefore insufficient substitutes for each other.

The full current-server hash is
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
The static proof reads nine bounded ranges totaling 14,210 bytes, including
completion, clear-threshold and flag-set/clear helpers. The accuracy update and
recovery getter read the flag. `GetInaccuracy` reads the accumulated penalty
and adds movement/air terms; it does not independently choose this baseline.
Raw instruction locations remain in the tool and local listings.
The full-hash run passed 13 semantic checks and 44 exact instruction assertions.

The original demo hash and retained decoded CSV hash are in the
[numeric fixture](evidence/reaudit-duck-accuracy-fixture.json). Native movement
states are combined with previously retained independent native accuracy
invocations. This is a supplied-state consumer check, not a new native gunshot
recording or a reconstruction of the original keyboard inputs.

| Check | Before | After |
|---|---:|---:|
| Actual range/duel active and inventory cases |168|168|
| Wrong stance selections |120|0|
| Penalty mismatches against native invocations |120|0|
| Maximum absolute penalty error |0.0100954175|0|

The cases cover AK-47, M4A4, M4A1-S, Desert Eagle, AWP and USP-S. Two agreeing
control poses per weapon/consumer are included. The
[before report](evidence/reaudit-duck-accuracy-before.json) and
[after report](evidence/reaudit-duck-accuracy-after.json) record the source
hashes and counts per engine and weapon. All 19 focused tests passed: ten
motor flag cases and nine common-weapon consumer/reset cases. The fixture
extractor reverified the original demo hash, 12 native transition checks and
33 flag facts used by the motor fixture.

Reproduction from the repository directory, with each command run serially:

```sh
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-duck-accuracy-proof.py --summary docs/evidence/reaudit-duck-accuracy-proof.json
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-duck-accuracy-fixture.py --verify-demo --write-portable
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% node tools/reaudit-duck-accuracy-engines.mjs
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% npx vitest run src/range/native-duck-flag.test.ts src/range/native-duck-accuracy.test.ts --maxWorkers=1
```

The byte proof and fixture exporter need the retained local binary/demo audit
workspace. The engine comparison and unit regressions use portable numeric
fixtures only. The baseline report remains historical; rerunning against the
fixed tree produces the after report.

Limits: the recorded transitions are free-space server states, sampled at 64 Hz.
Air transitions and ordinary ground flag timing are covered; a partly crouched
blocked expansion still retains the trainer's existing collision approximation.
No constrained-ceiling native trajectory, fatigue-boundary command timing or
partly crouched takeoff was added. The change makes no rendered-camera or
counterstrafe input-to-shot timing claim.

## Final integration

Both focused regression files pass all 19 cases; the actual-engine comparison has zero mismatches across all 168 cases.
The combined TypeScript/unit/browser results and remaining missing-model fixture
are recorded in the [audit inventory](cs2-reaudit.md).

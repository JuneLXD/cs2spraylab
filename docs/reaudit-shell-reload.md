# Pass 26: interrupting a loaded shotgun reload

Baseline: `6c725a1f2d745d4dbcc2e8c8bdd2f1ed119dbe2b`. The correction covers Nova,
XM1014 and Sawed-Off reloads that **began with ammunition loaded**. It fixes the
initial attack gate and cancellation when a valid shot occurs in Range and Duel.

Current server SHA-256:
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
The [portable evidence](evidence/reaudit-shell-reload.json) binds the native byte
ranges, vdata export, actual trainer source hashes and retained before/after runs.
Raw native layout stays in the probe and local `native-audit` artifacts.

## Native rule

The current RTTI/vtable bindings distinguish the three shell weapons from MAG7's
magazine path. The native shell post-frame checks primary input and primary
readiness before handling reload input. Readiness compares the normalized next
primary tick/fraction against player time inclusively. It does not reject an
attack merely because the weapon is reloading.

The shared reload-start action sets the reload flag and passes
`m_flDisallowAttackAfterReloadStartDuration` into the absolute attack-deadline
setter. The values are 0.466667 seconds for Nova and Sawed-Off, 0.6 seconds for
XM1014, and 2.5 seconds for MAG7. The initial call uses the ordinary duration;
no silent-playback multiplier appears on this path. This does not establish all
later silent-phase deadline behavior.

Once readiness and the ordinary player/weapon gates pass, the shell primary
callback checks loaded ammunition, changes directly to the shooting action,
resolves the shot and consumes ammunition. The action switch clears reload
state. It does not wait for the reload outro. The 0.2-second Nova/Sawed-Off and
0.25-second XM1014 literals in the primary wrappers belong to the **empty-fire
retry** branch; they are not loaded-shell interruption delays.

Evidence IDs: `SHELL-shell-post-frame`, `SHELL-primary-ready`,
`SHELL-primary-dispatch`, `SHELL-shell-primary-wrappers`,
`SHELL-shell-fire-helper`, `SHELL-action-change`, `SHELL-reload-start`,
`SHELL-action-begin`, `SHELL-deadline-setter`, `SHELL-next-primary-setter`,
`SHELL-reload-vdata-binding`, `SHELL-shell-reload-wrapper` and
`SHELL-primary-shell-policy`. The reusable proof checks four class bindings,
13 instruction ranges and 45 assertions against the installed server hash.

## Actual trainer measurements

The probe invokes `Simulation` and `DuelSimulation`, including their public reload
and attack input methods. It advances on the 128 Hz simulation grid plus exact
input edges; held attacks retain the existing 64 Hz processing convention.
One passive Duel opponent is retained and the player faces away. Two initial
ammo counts, six input times, held/released input, four weapons and both engines
produce 192 cases. This is an actual-engine comparison, not a native demo replay.

Both engines produced these first-shot times, relative to reload start:

| Loaded-start input | Weapon | Before | After |
| --- | --- | ---: | ---: |
| Held from 50 ms | Nova / Sawed-Off | 250 ms | 468.750 ms |
| Held from 50 ms | XM1014 | 250 ms | 609.375 ms |
| Press at 566.667 ms | Nova / Sawed-Off | 781.250 ms | 566.667 ms |
| Press at 700 ms | XM1014 | 906.250 ms | 700 ms |
| 7.8125 ms tap at those ready times | All three | No shot | Fires at press |
| Held from 50 ms | MAG7 control | 2500 ms | 2500 ms |

Before the change, a tap released early also prematurely ended the loaded
reload despite firing no shot. It now preserves the reload. Cancellation occurs
only when an eligible shot is about to fire; existing pump/deploy/action
cooldowns still gate that decision.

The 96 Range/Duel pairs have no first-shot mismatches. All 192 cases match the
instruction-bounded lock combined with the existing trainer input-clock rule.
There are 116 changed first-shot outcomes, including 44 formerly lost shots and
12 cases that previously fired before the initial lock. All 48 MAG7 controls
retain their first-shot outcomes. Five focused test files passed 135 tests,
including empty-start compatibility, ammo accounting, pump cooldown, ready taps
and early released taps.

## Deliberate limits

Shell intro (0.5 seconds), shell insertion cadence (currently reusing the reload
data value), and uninterrupted finish (0.2 seconds) remain estimates. The attack
lock is now named separately in the controller; its source field is explicit.
It must not be inferred from the estimated insertion phase if those timings
change later.

Exported viewmodel clips have intro/loop/ammo/outro markers, and current native
callbacks show ammo transfer on `WPN_RELOAD_ADD_AMMO` and completion on
`WPN_ACTION_COMPLETE`. Those facts alone do not establish absolute insertion or
completion deadlines: authoritative graph selection, phase entry, playback
rate and event/attack ordering still need corroboration. No native shell-reload
demo was captured in this pass.

Reloads that began empty retain the prior finish-delay approximation. The native
empty-fire retry clock and same-frame ammo-event ordering need to be measured
together before changing held-through-empty behavior. The clip export hashes
identify decoded exports, not a fresh individual comparison with compiled VPK
payloads. Manual reload admission during an existing attack cooldown, later
silent reload transitions, and exact native float/subtick normalization are
outside this correction.

## Reproduction

From the repository directory, with the installed game and retained local
`native-audit` evidence available:

```sh
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-shell-reload-native.py --proof
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% node tools/reaudit-shell-reload-trainer.mjs --output ../native-audit/reports/reaudit-shell-reload/trainer-after.json
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-shell-reload-report.py
```

The trainer probe defaults to `trainer-current.json` and refuses to overwrite
the retained `trainer-before.json`. The before/after fixture hashes are embedded
in the portable report. The probe starts no browser, game or analysis service.

Final delivery checks: TypeScript passed; 2,363 unit tests passed, with only the
documented missing `public/models/ak47.json` fallback fixture failure. All four
Chromium cases in trigger-continuity and view-punch passed in 53.1 seconds,
including real mouse input during a loaded Nova reload. Checks ran serially
under memory/swap/CPU caps with the repo frozen during browser execution.

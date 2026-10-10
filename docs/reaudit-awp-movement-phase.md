# AWP rescope movement and immediate shots — pass 46

The prepared stopping batch is held locally. A final actual-engine transition
check found a new zero-speed state during automatic AWP rescoping, and that
state removes movement inaccuracy from an immediate Range shot. Fixed-state
native movement parity does not establish that this state occurs in the game.
No timing or arithmetic patch is made from this evidence.

## What the native proof establishes

The [native phase ledger](evidence/reaudit-awp-movement-phase-native.json) verifies
the current server identity and a fixed 1,350-byte caller read. Its straight-line
path completes the movement loop, performs typed post-movement preparation,
then handles remaining weapon events. Twenty-one retained source hashes and
69 instruction checks bind the lower callbacks to the active weapon and the
AWP postframe. Eligible automatic rescope precedes common weapon input there.

A scope change in that command's remaining-event phase cannot alter movement
already completed for that command. This does not associate either trainer
half-tick with a native command, establish every earlier callback, or prescribe
a universal extra tick. The held-clock ledger's original full-hash limitation
is retained. See the [reproduction package](../tools/reaudit-awp-movement-phase-native/README.md).

## Actual trainer measurements

The same probe runs against live baseline `e99fd05` and local candidate
`4bb6223`. Each version executes 32 cumulative cases: both zoom levels, running
or walking, loaded or supplied-empty controls, arrival exactly at the derived
deadline or at the next 128 Hz boundary, and actual Range/full Duel callers.
The first shot uses the real firing APIs. No loaded ammo, deadline or pending
rescope state is fabricated after that shot. The empty control explicitly sets
ammo to zero just before eligibility and is not a native ammo-lifecycle claim.

All paired approach traces agree; the path is clear and the opponent is placed
away from it. Range advances rescope before movement; Duel moves before its
weapon update. At the tested next-boundary arrival:

| Supplied state | Live Range / Duel velocity | Local Range / Duel velocity |
| --- | ---: | ---: |
| Running, either scope | 100 / 200 u/s | 0 / 200 u/s |
| Walking, either scope | 52 / 104 u/s | 0 / 104 u/s |

The exact-deadline control retains the nonzero Range endpoint. All eight paired
empty controls agree. Across loaded states, maximum arrival position disagreement
grows from 0.390625 to 1.5625 native units. These are differences between trainer
modes, not measured errors against live CS2.

Normal continuation and a zero-time diagnostic run independently: 6,048 and
6,080 rows per version. The diagnostic itself clamps Duel velocity, so the
earlier archived traces after that call must not be described as untouched
normal motion. The final evidence retains both continuations separately.

A second probe fires 16 actual fresh shots per version at those loaded arrivals.
It records the existing accuracy function's arguments and returns its result
unchanged. Four candidate Range shots consume a zero movement ratio; none of
the baseline shots do. Both versions fire through their actual APIs: Range's
immediate trigger and Duel's input processed by `step(0)`. That Duel call also
performs its existing movement clamp. Base and other accuracy penalties remain;
zero movement inaccuracy does not mean perfect accuracy.

The [trainer ledger](evidence/reaudit-awp-movement-phase-trainer.json) binds all
70 application source hashes to the already tested pass-45 snapshot, both
before/after probes, every pair, and the shot observations. These are capped
512 MiB measurements; no application source changed or live game launched.

## Why no guessed fix ships

The abrupt-cap endpoint follows the structure of the already executed native
215-to-107.5 u/s supplied-state regression: the cap contributes acceleration
work, and the strict projected-speed gate can clear the endpoint. That supports
the arithmetic, not the trainer's decision to put a scope-induced cap change
into this particular half-step. Moving Range's rescope call also changes which
ammo state it sees around reload/refill and still does not identify a native
command boundary.

Required next evidence is a native moving-rescope window with command identity,
movement segment boundaries, sampled maximum speed, scope state, weapon
postframe time and subsequent shot accuracy. Retained AWP shot/scope plans
contain no planned movement; the AWP footstep plan contains no shots or zoom.
No eligible combined capture emerged from the bounded metadata screen. Tick
samples alone could miss a shorter transient and cannot establish invocation
order. No broad analysis or new capture was started.

The pass-44 stopping and pass-45 scoped-motion comparisons remain valid for
their declared supplied states. Their combined application batch is not approved
for release on that basis alone. The LAN continues to serve `e99fd05`.

## Reproduce the trainer observation

Run `tools/reaudit-awp-movement-phase-trainer.mjs --repo <checkout> --output <new.json>`
once with `--without-zero-time` for normal continuation, and independently
without that flag for the diagnostic. Run `tools/reaudit-awp-rescope-shot.mjs`
with the same repo/output arguments for the actual shot probe. All outputs
refuse overwrite. The summary tool verifies reports and unchanged application
sources. Use the documented 512 MiB, zero-swap, one-CPU scope after checking
deployment is inactive and host available memory exceeds 12 GiB.

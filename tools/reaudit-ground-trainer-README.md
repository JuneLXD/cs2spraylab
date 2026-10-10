# Actual trainer movement comparisons

Run serially with the native-package preflight and memory caps: deployment
inactive, at least 12 GiB available, 512 MiB per probe, no swap, one CPU.
Use the native package's separately supplied matching server library to produce
release, combined and stance outputs first. No game or analysis server is needed.

The exporter validates the pinned canonical native execution content, including
all rows, fixtures, hooks and guard counts. Its trainer inputs omit path-dependent
reader metadata; separate `.source.json` sidecars retain exact raw identities.
Run each command under the capped prefix, with unused output paths:

```sh
python3 tools/reaudit-ground-friction-cases.py /tmp/ground-release/native.json /tmp/release-cases.json
python3 tools/reaudit-ground-friction-cases.py /tmp/ground-combined/native.json /tmp/combined-cases.json --kind combined
python3 tools/reaudit-ground-friction-cases.py /tmp/ground-stance/native.json /tmp/stance-cases.json --kind stance
node tools/reaudit-ground-release-trainer.mjs --repo . --native /tmp/release-cases.json --output /tmp/release-trainer.json
node tools/reaudit-ground-combined-trainer.mjs --repo . --native /tmp/combined-cases.json --output /tmp/combined-trainer.json
node tools/reaudit-ground-combined-trainer.mjs --repo . --native /tmp/stance-cases.json --output /tmp/stance-trainer.json --stance
node tools/reaudit-stopping-engines.mjs --repo . --output /tmp/stopping-engines.json
```

To reproduce the combined before measurement, pass `--repo` pointing to a clean
`e99fd05` checkout and add `--baseline`. Both comparisons use the same native
inputs; baseline skips primitive/cache checks for code it did not implement.
Reports hash the actual bundled source and preserve all observed rows. They
refuse existing output paths.

The release tool covers all native primitive rows and cumulatively advances
96 unique release fixtures under two caller schedules. The combined tool
also checks native acceleration/work and cap/work, then advances 231 standing
fixtures under two schedules. The stance extension checks 124 supplied
stance/cap fixtures similarly. The caller either supplies every native segment
or only external event boundaries; the latter requires the actor's own cache
boundary insertion. State is carried from the initial seed throughout.

The engine probe covers seven weapons, four release phases and release versus
counter-input in the actual actor, Range and Duel engines. It checks those
implementations agree; it does not itself execute native code.

Permanent fixture generators:

```sh
node tools/reaudit-ground-friction-stop-fixture.mjs /tmp/release-cases.json /tmp/native-ground-friction-stop-fixture.json
node tools/reaudit-ground-combined-fixture.mjs /tmp/combined-cases.json /tmp/native-ground-combined-fixture.json
```

The older `reaudit-ground-friction-fixture.mjs` preserves the original v1/v2
regression selection and accepts the hash-pinned historical reports from the
local archive. Its original input identities remain in the committed fixture.
Fresh portable release/counter/stop replays above cover the later complete
pipeline; they do not require those older reports.

All checks are supplied-state evidence. Position is derived uncollided native
midpoint displacement. Full native collision/commands, physical input timing,
upstream stance/tag cap construction and variable surface/base-velocity behavior
are outside this package. A zero movement contribution does not remove base
spread or other shot penalties.

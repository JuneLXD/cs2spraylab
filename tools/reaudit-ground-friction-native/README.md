The native replay runs selected instructions from a separately supplied,
matching CS2 server library. No game or analysis server is needed. This
directory contains reproducible readers and hashes, without the saved native
executable span. The original v1/v2 readers and reports remain preserved in
the local audit archive.

Python dependencies: `capstone`, `pyelftools`, `unicorn`. Use an environment
where these packages are already installed. An existing dependency directory
can be provided through `PYTHONPATH`.

Run only one audit/test/build/capture job at a time. Before execution, check
that `spraylab-deploy.service` is inactive and at least 12 GiB is available.
Use `systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0
-p CPUQuota=100%` in front of each Python command. Full file hashing streams
the supplied server library. The proof and oracle refuse mismatching hashes
and refuse to overwrite their output.

From the repository root, use the capped prefix above with:

```sh
python3 tools/reaudit-ground-friction-native/proof.py --binary "$CS2_SERVER" --out /tmp/ground-proof.json
python3 tools/reaudit-ground-friction-native/release_oracle.py --binary "$CS2_SERVER" --out /tmp/ground-release
python3 tools/reaudit-ground-friction-native/compare.py --kind release --report /tmp/ground-release/native.json
python3 tools/reaudit-ground-friction-native/oracle.py --binary "$CS2_SERVER" --out /tmp/ground-combined
python3 tools/reaudit-ground-friction-native/compare.py --kind combined --report /tmp/ground-combined/native.json
python3 tools/reaudit-ground-friction-native/stance_oracle.py --binary "$CS2_SERVER" --out /tmp/ground-stance
python3 tools/reaudit-ground-friction-native/compare.py --kind stance --report /tmp/ground-stance/native.json
python3 tools/reaudit-ground-friction-native/stance_regressions.py --binary "$CS2_SERVER" --stance-report /tmp/ground-stance/native.json --out /tmp/ground-stance-regressions
```

Set `CS2_SERVER` to the matching installed `libserver.so`. Output paths must
be unused. The preserved `reaudit-friction-native-oracle*.py` files are
byte-identical dependency modules; run the portable entry points above.

The release replay supplies processed wish vectors, velocity/cache state,
friction factors and command schedules. It executes quantization, cache
decisions, friction, midpoint/endpoint helpers, the strictly-below-one stop
branch, and the per-segment wish copy. The combined replay also executes
native finite wish normalization, standing acceleration with friction
overshoot, and final speed-cap/work correction. Its weapon/service getters
return explicit supplied values; dry, unscoped standing state is enforced.
Walking, ducking and scoped movement are outside that combined replay.

The separate stance replay reuses the combined reader without changing it.
It permits the existing walking/crouched branches only for declared fixtures,
adds an eight-byte private owner pointer and an 80-byte private service object,
and supplies an invalid service handle. Every other branch/access guard stays
active. No native code range or accessor hook is added. The same whole-binary,
range, class and schema proof runs before execution; no local audit archive
is needed.

Stance fixtures separate the supplied weapon getter speed from the processed
cap. Their authored cap is `float32(weaponSpeed * multiplier * tag)`, rounding
only the product, with multipliers 1, .52 and .34 and tag labels 1 and .5.
These labels do not execute or validate upstream stance/tag modifiers. The
124 fixtures cover five weapon speeds, three stances, two tag labels, four
initial-speed levels, and four old midpoint states; three alternate-MXCSR
repeats give 127 sequences and 3,909 rows. Existing native normalization,
acceleration, cap correction, midpoint/stop/post helpers and state handoff
remain the execution under test.

The portable stance replay matches the preserved original execution digest
for all 3,909 rows. Release/combined digests remain unchanged.

`stance_regressions.py` also checks three supplied historical-test states:
full-run to walk for a 215-unit weapon, and one already-crouched step for
215/240-unit weapons. The packaged input file records the exact prior state,
command fractions, trainer source hashes and outputs. Only a command-start
case resets the marker; the two half-command cases preserve the supplied
marker and finish the command afterward. Native before/cache/work/cap/helper
states and final outputs are retained. Velocity and cache match the trainer
exactly; derived displacement differs only by the recorded SI conversion
round trip. The comparison bound is 1e-11 native units for displacement and
1e-11 native units/s for velocity, with exact cache comparisons.

The compact `docs/evidence/reaudit-ground-stance-regressions.json` also
includes the four original midpoint controls from the digest-checked stance
report. It records their native midpoint, endpoint, derived displacement and
cache state. These controls justify native float32 expectations rather than
ideal double endpoint means or decimal cap assertions. The three new steps
do not validate the preceding stance ramp or upstream cap production.

Outer command marker and saved-fraction insertion rules are byte-bound
harness operations. Collision, complete command dispatch, pawn publishing,
and physical input timing are outside both replays. MXCSR profiles are
explicit supplied settings. `compare.py` checks every execution row, work
vector, cache state, control case and hook count against the preserved
content digest while allowing portable proof/path metadata to differ.

The compact endpoint artifact retains every release endpoint and hashes the
full guarded report. It is suitable for the separately bound weapon accuracy
normalizer; it does not itself execute weapon inaccuracy.

This separate extension replays two supplied historical-test states through
the unchanged native cache/friction/acceleration/cap/pre/stop/post pipeline.
It adds no native code, hook, branch or private span. Existing replay readers,
fixtures and content digests remain unchanged.

Use the same dependencies, matching server library and serialized host guards
as the package README. The deployment service must be inactive and at least
12 GiB available. From the repository root:

```sh
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-ground-friction-native/supplied_cap_regressions.py --binary "$CS2_SERVER" --out /tmp/ground-supplied-cap-regressions
```

The input file is pinned by SHA and records the exported trainer source hashes.
Those hashes describe the exact supplied-state export, before the subsequent
long-duration subdivision fix. Each case supplies velocity, previous wish,
cache/marker state, processed cap, weapon speed and command fractions. The
first starts a command; the second preserves the half-command state and then
finishes the command. Output directories must be unused.

The abrupt supplied cap reduction from 215 to 107.5 reaches the actual native
stop branch after cap/work correction. Native velocity and derived uncollided
displacement are zero, matching the exported trainer result exactly. An
authored float32 diagnostic from the native pre-helper state projects a speed
of 0.0000152587890625, below the branch's strict threshold of one. The actual
native branch result is retained separately from that diagnostic. This is not
a proof of upstream native tagging application or cap production.

The supplied AK diagonal state retains native components
`[152.0279541015625, -152.0279541015625]`. Their derived double Euclidean norm
is `214.9999945502641`; this is not a separate native speed-getter result.
The stop branch is not taken. Native endpoint components and cache state match
the trainer exactly. The largest displacement difference from SI conversion
and subtraction is 7.416289804496046e-14 native units, below the unchanged
1e-11 comparison bound.

The compact fixture at
`docs/evidence/reaudit-ground-tag-diagonal-regressions.json` retains both
supplied states, native before/cache/work/cap/helper/gate/after values,
comparisons and provenance. Strict memory guards recorded 318 reads and 181
writes with zero unexpected accesses. The raw proof report remains local;
its hash is retained in the compact fixture. No preceding native trajectory,
input-production pipeline, collision or complete command replay is claimed.

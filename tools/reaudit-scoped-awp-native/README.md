# Scoped AWP ground replay

This package extends the frozen ground oracle with supplied AWP speed 100,
current zoom level 1 or 2, and configured zoom count 2. It uses the same 7,192
native code bytes and four accessor hooks. The only extra private inputs are an
8-byte weapon-data pointer and the 4-byte configured count. Existing stance
private state and the invalid walking service handle are retained.

The current-zoom getter is joined to the retained, matching-hash AWP secondary
dispatch: that dispatch advances the same instance integer, compares it against
the configured count, and applies the selected scope. A fixed current-server
schema read names the second integer `m_nZoomLevels`. Raw locations stay in the
tools and static proof artifacts.

Requires Python 3, Unicorn, Capstone, pyelftools, the sibling
`reaudit-ground-friction-native` package, and a separately supplied matching
`libserver.so`. The server digest is
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
No game, full analysis server or bridge is required. All output destinations
must be new; tools refuse to overwrite reports.

Run serially, with deployment inactive and at least 12 GiB available. Do not
overlap a replay with tests, builds, browsers or native capture. From the repo:

```bash
free -g
systemctl --user is-active spraylab-deploy.service
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-scoped-awp-native/read-static.py --binary /path/to/libserver.so --out /tmp/scoped-awp-static-new
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-scoped-awp-native/oracle.py --binary /path/to/libserver.so --out /tmp/scoped-awp-native-new
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-scoped-awp-native/export.py --report /tmp/scoped-awp-native-new/native.json --out /tmp/scoped-awp-input-new.json --expect-execution-sha be38d9c1ab4430ffcef202125806061ef226fe951e15011453101f89a0802880
```

The static reader rechecks the whole artifact digest, then only the fixed
3,640-byte selection and its exact retained read ledger. The oracle verifies
the frozen ground manifest, scope-join reports and weapon-data evidence before
executing the bounded code. It checks all native instruction and data accesses.
The exporter keeps every semantic intermediate and endpoint while removing
pointer, raw-byte and access-address ledgers. Its canonical digest ignores
local proof paths while retaining fixtures, rows, hooks, MXCSR profiles and
guard counts. The original release/combined/stance package is unchanged.

There are 30 fixtures and 32 profile sequences, totaling 844 segment rows:
standing/walking/crouching start, release, counter-input and diagonal motion at
both zoom levels; three additional walking taper input controls per level; and
two extra FTZ/DAZ profile sequences. Fixture IDs are
`awp-zoom{1|2}-{stand|walk|crouch}-{start|release|counter|diagonal}` and
`awp-zoom{1|2}-walk-taper-input{50|52|55}`. The latter supply initial speeds;
they are not a claim that the post-friction speed equals a taper boundary.

These are supplied-state native arithmetic cases. The native getter values,
stance, processed cap, schedules and floating-point environment are explicit
inputs. The replay does not invoke scope transitions, upstream cap modifiers,
collision, complete command dispatch or physical input production. Position is
the existing derived uncollided midpoint displacement. Native zoom levels 1
and 2 produce identical rows in all 15 paired gradual-profile fixtures.

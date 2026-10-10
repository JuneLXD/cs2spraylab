# Portable accuracy input validation

Use `prepare-input.py` before the portable normalizer. It imports the pinned
`../reaudit-ground-friction-native/compare.py` validator and requires the exact
native execution digest, including every fixture, row, hook, MXCSR result and
guard count. It then reconstructs every compact release endpoint and compares
its canonical content, preserving signed zero. Raw paths, reader hashes and
report hashes go into a separate provenance sidecar and are not an allowlist.

The preparation process finishes before Unicorn starts. Thus the full report
parse and native normalization never occupy memory in the same process. Both
stages use the existing 512 MiB/zero-swap/one-CPU cap and the sole heavy slot.
Perform the deploy-inactive/12-GiB preflight before each command.

`normalize-portable.py` requires stable endpoint semantic SHA-256
`0f6688a632ff3a51f427afb38b8a5d1ee7f5a307ac200285957101bd90324b05`
and movement execution SHA-256
`b8dbfe8e2b6997488e8f3b6da5ebf3fb01dbf68200f94ea9d03af07d6f8f46e9`.
It retains the same native code/constants and memory guards as the original
normalizer. `summarize-portable.py` checks exact canonical equality of all
normalization rows, threshold cases, native block hash, MXCSR results and
guard counts against the preserved original normalization proof.

The sibling movement validator is pinned to SHA-256
`3433a8539a8060af211097d350c35885a33e12f222f69b83ecb16dd424a384b6`.
The comparison's original proof is a retained external input, SHA-256
`8afbe32b9d37c38908eb31d353d97a2b05b20d71c869d6b8243083e7493efe41`.
Original tools and docs evidence are unchanged; the old manifest and README
are preserved as `manifest-v3-raw.json` and `README-v3-raw.md`.

Example after generating a fresh portable movement report:

```bash
AUDIT_ROOT=/home/junel/Desktop/cs2
MOVEMENT_OUTPUT="$AUDIT_ROOT/native-audit/reports/core-shooting-next/movement/portable-ground-001/release"
ACCURACY_TOOLS=tools/reaudit-ground-friction-accuracy
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% \
  python3 "$ACCURACY_TOOLS/prepare-input.py" \
  --native-report "$MOVEMENT_OUTPUT/native.json" \
  --compact "$MOVEMENT_OUTPUT/release-endpoints.json" \
  --fixtures "$MOVEMENT_OUTPUT/fixtures.json" --output /tmp/spraylab-accuracy-input-new

systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% \
  python3 "$ACCURACY_TOOLS/normalize-portable.py" --root "$AUDIT_ROOT" \
  --input /tmp/spraylab-accuracy-input-new/endpoints.json \
  --input-sha256 1bca7690d6112e29df61de904fb7ea37c9623cdfd277d340caf2dd1e1920277e \
  --provenance /tmp/spraylab-accuracy-input-new/provenance.json \
  --fixtures "$MOVEMENT_OUTPUT/fixtures.json" --output /tmp/spraylab-accuracy-portable-new

systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% \
  python3 "$ACCURACY_TOOLS/summarize-portable.py" \
  --proof /tmp/spraylab-accuracy-portable-new/proof.json \
  --proof-sha256 EXACT_HASH_PRINTED_BY_NORMALIZE \
  --source /tmp/spraylab-accuracy-input-new/endpoints.json \
  --original-proof "$AUDIT_ROOT/native-audit/reports/core-shooting-next/movement/movement-inaccuracy/packaged-v3/proof.json" \
  --output /tmp/spraylab-accuracy-portable-summary-new.json
```

The stable input hash identifies reconstructed semantic data, not a raw native
report tied to its file path or reader metadata. No raw-report hash exception
is required for a reproduced execution with identical content.

The following original method details and exact-raw reproduction remain valid.

# Native ground movement accuracy check

`AUDIT-GROUND-FRICTION-ACCURACY-01` is a local proof identifier, not an
REA-issued ledger ID. This package checks the movement part of shooting
inaccuracy for supplied release endpoints. It does not launch CS2.

The normalizer executes exactly 134 current-server code bytes and reads
three four-byte constants. It starts after the owner velocity getter and
stops before the coefficient/power branch. It accepts the exact-hash v3 compact
friction report, its fixture file and an empty output path, and refuses to
overwrite output. Every instruction and data span is guarded; each case
has an 80-instruction limit. No full ELF mapping, discovery scan, owner
getter, weapon getter, complete movement function or shot dispatcher runs.

The supplied positive speed, post-helper XY endpoint and MXCSR profile
come from each release fixture. A zero normalized result establishes zero
**movement contribution** for that supplied sample. It does not establish
zero total inaccuracy or spread, or a real physical-input latency.

`summarize.py` compares the native first-zero endpoints against the pinned
v3 compact report's derived boundary selections and emits sanitized compact JSON.
It also records the separate static field association and its limitation:
the changed-vector setter copies the exact GetInaccuracy owner vector and
clears its refresh bit, while notification/helper/callback effects remain
partly uninspected. Complete setter side effects are not claimed closed.

## Dependencies and identities

- Current server artifact SHA-256:
  `c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
- V3 complete native report SHA-256:
  `2149c9a308674fbb3198318419e434fb2eabaa5ba0f83b0ab6d11498600d60df`.
- V3 compact release endpoint SHA-256:
  `453a5156ccbf95ee38bea518a9da965d566e0840ea6cce77ce72db3efab25c8c`.
- V3 canonical fixture definition SHA-256:
  `4600d5b952bef24f8fa6b21d6553b04f01a297f536acaf304da910459bf63a71`.
- Retained source prerequisites are bundled under `prerequisites/` with
  their original hashes and origins in `manifest.json`. Raw native details
  stay in tools and local output, not the compact docs evidence.
- `--root` identifies the audit data root, containing
  `cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so` and the existing
  `native-audit/python` Capstone/Unicorn installation. The v3 native report, its `fixtures.json`, and compact
  `release-endpoints.json` are separate inputs produced by the movement
  package. The complete 87.82 MB report is streaming-hashed, never parsed
  by the normalizer; only its 2.14 MB compact endpoint artifact is parsed. All output directories must be new.

The preserved historical v2 run covered 4,075 endpoint samples from 98 sequences / 96
unique release fixtures, plus 30 float32 threshold-neighbor samples. Both
supplied MXCSR profiles are covered; neither is claimed sampled from a live
game. All 98 native boundary selections matched the v2 derived boundaries.
The v3 package extends the check to 10,939 endpoints including exact stopping,
plus the same 30 float32 neighbors; the evaluated accuracy boundary occurs
before the stop gate.
The 250-unit supplied speed is an additional sensitivity case.

## Reproduction

Coordinate the host's sole heavy-job slot first. Confirm the deploy service
is inactive and at least 12 GiB is available; do not overlap tests, builds,
captures, or another native probe. Run under the existing 512 MiB memory,
zero-swap and one-CPU caps. For example, from the checkout containing this
package, after those preflight checks:

```bash
AUDIT_ROOT=/home/junel/Desktop/cs2
V3="$AUDIT_ROOT/native-audit/reports/core-shooting-next/movement/native-friction-oracle-v3/run-001"
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% \
  python3 tools/reaudit-ground-friction-accuracy/normalize.py \
  --root "$AUDIT_ROOT" --input "$V3/release-endpoints.json" \
  --input-sha256 453a5156ccbf95ee38bea518a9da965d566e0840ea6cce77ce72db3efab25c8c \
  --native-report "$V3/native.json" --fixtures "$V3/fixtures.json" --output /tmp/spraylab-accuracy-normalization-new
```

Use the exact output proof hash printed by that run with `summarize.py`:

```bash
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% \
  python3 tools/reaudit-ground-friction-accuracy/summarize.py \
  --proof /tmp/spraylab-accuracy-normalization-new/proof.json \
  --proof-sha256 EXACT_HASH_PRINTED_BY_NORMALIZE \
  --source "$V3/release-endpoints.json" --output /tmp/spraylab-accuracy-summary-new.json
```

The tool records failure and any bounded read transcript if native/input
validation fails. Stop on such failure; do not widen the reader or retry
memory failures automatically.

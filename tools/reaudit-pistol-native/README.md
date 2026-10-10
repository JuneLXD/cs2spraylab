# Common pistol recoil selector and command seed field

This package reproduces the completed bounded static investigation. It does
not discover or execute the upstream seed producer. `read.py` streams the
two exact artifact hashes, checks retained native-data prerequisites, and
reads 16,830 selected bytes, including 42 common-weapon virtual slots.
Every code range is at most 3,104 bytes and must match its frozen range hash.
The output contains local raw listings. `check.py` verifies those listings
and writes two sanitized JSON proofs with 96 supplied-state derived cases.
Neither command overwrites an existing output directory.

Local proof identifiers (not REA-issued ledger IDs):

- `AUDIT-PISTOL-SELECTOR-01`, rules `PS01`–`PS05`: separate floating recovery
  index and command-seed table selector, six-bit table mask, call order,
  common pistol scope path and separate AWP magnitude path.
- `AUDIT-PISTOL-SEED-FIELD-01`, rules `PF01`–`PF03`: the exact client and server
  generated protobuf parsers bind the consumed field to
  `CBaseUserCmdPB.random_seed`, optional `int32`, tag 10.

Current native artifact SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| `libserver.so` | `c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a` |
| `libclient.so` | `eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1` |
| Retained compiled `scripts/weapons.vdata_c` | `5ca094238e180376646a5cd69250c091ae5a9d937a3446c188ee5117fb6da28b` |
| Retained decoded `scripts/weapons.vdata` | `46e7a84b46c620e8daf11c403ee9152a5faa1a033407748b527862aa3147236b` |

`source-manifest.json` contains exact selected ranges, instruction assertions,
original proof hashes and every retained prerequisite hash. The native-data
prerequisites are the decoded resource, the original parsed seven-weapon
report, its extraction script and KV3 parser, and the pass-39 compiled-resource
identity report. This package validates their fixed hashes and uses the
retained extraction; it does not rerun Source2Viewer or claim a fresh live
weapon-data observation. Missing or changed prerequisites are fatal.

Python dependencies are `capstone`, `pyelftools` and `protobuf`. The reader
adds `<root>/native-audit/python` to its dependency path. The checker uses
only the Python standard library and retained files. `<root>` is the audit
workspace containing `cs2-game` and `native-audit`; it is not this Git checkout.

Run from the repository root, serially, under the shared heavy-job slot.
First require deployment inactive, at least 12 GiB available, and no other
audit/build/test/capture job. Pause the deploy timer for the long audit session
according to the host instructions. Do not raise the cap on failure.

```sh
audit_workspace=/home/junel/Desktop/cs2
audit_raw="$audit_workspace/native-audit/reports/core-shooting-next/pistol-packaged"
audit_proofs="$audit_raw/proofs"
free -g
systemctl --user is-active spraylab-deploy.service
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-pistol-native/read.py --root "$audit_workspace" --output "$audit_raw"
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-pistol-native/check.py --root "$audit_workspace" --input "$audit_raw" --output "$audit_proofs"
```

The resulting `reaudit-pistol-selector-native.json` and
`reaudit-pistol-seed-field-native.json` are suitable for `docs/evidence/`.
Raw offsets stay in this tool manifest and local reader output.

The proof is static. Its 96 cases are derived from supplied branch inputs,
not executed native commands. It establishes which table selector a command
seed drives; it does not establish the seed's generating algorithm,
distribution, command cadence, or correspondence to browser input.
Inverse replay indices reconstructed from native recoil impulses are inferred
table choices, not recorded command seeds. A supplied-selector replay can
validate the branch while default gameplay remains unchanged. No authored
default seed sequence is justified by these findings. Current-build static
proof also does not establish the executing binary of a historical demo.

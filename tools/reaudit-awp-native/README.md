# AWP native clock proof

These four readers and the checker reproduce the bounded AWP server audit. They inspect files; they do not launch CS2, execute native code, run Ghidra, or export new weapon data. The decoded weapon data is the retained pass 38 export, accepted only after both its text hash and the current compiled VPK entry hash match that pass's manifest.

`source-manifest.json` records the original five script hashes, their adapted copy hashes, and the original evidence hashes. The originals in `native-audit/reports/awp-clocks-next` remain unchanged. Copies accept explicit paths, resolve repository dependencies locally, and refuse to overwrite their report. Their own source hashes intentionally differ from the original proof.

## Required files

Run from this repository checkout. `--root` identifies the containing audit workspace, with:

- `cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so`
- `cs2-game/game/csgo/pak01_dir.vpk` and the referenced archive files
- `native-audit/python` containing the existing Capstone and pyelftools dependencies
- `native-audit/reports/common-burst-next/native-data/scripts/weapons.vdata`
- `cs2spraylab/.local-tools/vrf-linux/Source2Viewer-CLI` (hashed for provenance, never executed)

The repository must retain `tools/kv3.mjs` and `docs/evidence/reaudit-glock-data.json`. The server readers fail unless the whole binary SHA-256 is `c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`. A changed CS2 artifact requires a new audit, not updating that assertion alone.

The data reader optionally accepts `--vpk PATH`, `--vdata PATH`, and `--exporter PATH`. All readers require `--root ROOT --output NEW_DIR`; the checker accepts the same interface and consumes that output directory.

## Serialized reproduction

Observe the host's deploy and memory rules first. Use a new output directory outside the repository; keep all five commands serial, with no concurrent deploy, tests, browser, export, or capture. These commands each use a 512 MiB memory limit, zero swap, and one CPU quota. Do not rerun into an existing evidence directory.

```sh
audit_workspace=/home/junel/Desktop/cs2
audit_output="$audit_workspace/native-audit/reports/awp-clocks-next/packaged-rerun"

systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-awp-native/read-current.py --root "$audit_workspace" --output "$audit_output"
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-awp-native/read-next.py --root "$audit_workspace" --output "$audit_output"
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-awp-native/read-metadata.py --root "$audit_workspace" --output "$audit_output"
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% node tools/reaudit-awp-native/read-data.mjs --root "$audit_workspace" --output "$audit_output"
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-awp-native/check-proof.py --root "$audit_workspace" --output "$audit_output"
```

Expected checker totals: 137 instruction assertions, five literal assertions, 16 concrete virtual bindings, eight schema fields, 36 retained ranges, and 37,267 bounded bytes read in addition to whole-artifact hashing. Raw addresses and disassembly stay in these tools and the local output directory. `portable-proof.json` contains named evidence hashes and address-free rules. The retained filenames `tick-pair-minmax` and `tick-pair-convert` are exploratory labels: the inspected functions add tick pairs and increment one tick respectively; filenames are not evidence of their behavior.

## Interpretation limits

For the current unlinked AWP clocks, the native context flag decides whether a shot adds the cycle to existing primary/secondary deadlines or first rebases each deadline to at least the current command clock. This audit does not identify that flag's runtime value for the trainer's queued input. Integrating with the trainer's existing scheduler therefore remains narrower than implementing native command/history selection.

Rescope checks primary readiness and ammunition, precedes input dispatch, and starts its FOV transition when processed. It does not wait for secondary readiness. The ordinary loaded fire/zoom path preserves secondary readiness at or after primary readiness if that ordering holds initially; establishing the ordering through every reload, deploy, holster, and special state remains open. Existing simultaneous AWP primary/secondary priority in the trainer is an adjacent gap outside the clock correction. There is no new game capture or client prediction/rendering proof in this pass.

# AWP input-priority proof

This package checks the native rule used by the narrow AWP primary-priority correction. It contains exact copies of the local investigation tools, with source and final output hashes in `source-manifest.json`.

The proof reuses hash-matched pass 39 AWP dispatch/data evidence and pass 38 shared secondary-wrapper evidence. Two new bounded reads add 1,536 bytes of selected server code/metadata beyond whole-artifact hashing: the preference string is `cl_debounce_zoom`, and the consume path calls another helper before recording the selected input bit. That helper's semantics and the producer/reset lifetime remain open. No game, native code, client process, Ghidra operation, or new data export runs here.

The checked rule is primary activity **and primary readiness**, independent of whether the primary handler accepts another semiautomatic shot. A not-ready primary does not win this arbitration. Secondary activity/readiness is re-evaluated at each native dispatcher invocation, but that does not establish how physical held input maps into those predicates. Preserve the trainer's existing Zoom Repeat setting and cadence.

## Reproduce from retained evidence

Run from this repository. `--root` is the containing audit workspace. It must retain:

- `native-audit/reports/awp-clocks-next`: pass 39 readers, reports, and named listings, including the hash-bound data proof.
- `native-audit/reports/common-burst-next`: pass 38 secondary-wrapper/thunk readers, reports, and listings.
- `native-audit/reports/awp-input-next`: original copies of these tools and the `current-gaps` and `consume-tail` selected-read outputs.

Use a fresh output directory. Observe the host deploy and memory rules, reserve one serial slot, and run these commands one at a time. The checker and derived-case generator each use 512 MiB memory, zero swap, and one CPU quota.

```sh
audit_workspace=/home/junel/Desktop/cs2
audit_output="$audit_workspace/native-audit/reports/awp-input-next/reproduced"

systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-awp-input-native/check-priority.py --root "$audit_workspace" --output "$audit_output"
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-awp-input-native/derive-cases.py --proof "$audit_output/priority-proof.json" --output "$audit_output/derived-cases.json"
```

Expected results are 96 instruction assertions, seven concrete AWP virtual bindings, 64 derived truth-table cases, and eight named examples. The named examples include both-ready inputs, held semiautomatic rejection, primary cooldown, secondary readiness, both preference values, and primary release. They model already-evaluated native input/readiness booleans with other gates permissive; they are not native runtime observations or a physical-input simulator.

## Optional repeat of the selected byte reads

The original reads have already passed. Repeat only when a new current-byte check is needed, in the same serial slot and caps. These commands additionally require the current `cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so` and the existing Capstone/pyelftools dependencies under `native-audit/python`. Each reader verifies server SHA-256 `c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a` before reading selected windows. Do not replace that hash to accommodate an updated game.

```sh
audit_workspace=/home/junel/Desktop/cs2
audit_output="$audit_workspace/native-audit/reports/awp-input-next/fresh-reproduction"

systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-awp-input-native/read-gaps.py --root "$audit_workspace" --output "$audit_output/gaps"
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-awp-input-native/read-consume-tail.py --root "$audit_workspace" --output "$audit_output/consume"
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-awp-input-native/check-priority.py --root "$audit_workspace" --gaps "$audit_output/gaps" --consume "$audit_output/consume" --output "$audit_output/checked"
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-awp-input-native/derive-cases.py --proof "$audit_output/checked/priority-proof.json" --output "$audit_output/checked/derived-cases.json"
```

Raw addresses/listings remain in these tools and local selected-read output. The final proof and derived-case JSON contain named, address-free findings. Reusing an output path is refused. A fresh reproduction can change the proof's relative source paths and resulting report hash without changing instruction/code hashes or rules.

## Integration limits

The priority guard does not port native command aggregation, player/equip/reload gates, shot-counter producers, input-mask resets, or the consume helper. It makes no claim about the live preference/default. Separate equal-time DOM edges remain sequential browser events, whereas the native dispatcher receives a processed command. Range and Duel release/repeat timing therefore must retain their measured frame/event boundaries; this proof does not supply a generic retry delay. The full special-weapon secondary-wrapper branch is deliberately left outside this AWP priority correction.

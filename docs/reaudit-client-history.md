# Client command history and presented-frame clocks

Reviewed baseline `9391437`; evidence only. The ordinary first attack press is
associated with a saved presented-frame record. That record contains a player
clock captured while constructing the frame. It is not a timestamp reconstructed
from the button event or weapon deadline. This resolves the construction layer
left open by [the camera-clock audit](reaudit-camera-clocks.md), but does not yet
establish the phase of an equivalent trainer implementation.

The [portable evidence](evidence/reaudit-client-history.json) records the rules,
range digests, checks and remaining runtime metadata. No production behavior is
changed.

## Current artifact evidence

[The probe](../tools/reaudit-client-history.py) reads the installed ELF files,
extracts their bounded disassembly ranges and parses the client's embedded
`cs_usercmd.proto`. It checks 24 instructions and 11 interface/parser bindings.
All checks pass. The 27 inspected ranges total 16,775 bytes; the largest is
5,120 bytes, below the probe's 8,192-byte per-range limit. These are static
assertions and reviewed disassembly, not execution of the native input loop.

| Artifact | SHA-256 |
|---|---|
| Client ELF | `eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1` |
| Engine2 ELF | `f5745c46cb38b1d120c3c7c5f0f19590f46c3d1bd136ee527b276cce8bfaba14` |
| Embedded descriptor, 1,167 bytes | `bae5f2466f7174a42246a2d51bcb1dc7acd28bb5dc3f47b631739d48909c8a8c` |

The probe rejects other client/engine hashes. Raw locations and object layout
remain in the probe and local audit artifacts. Portable evidence contains no
absolute paths or native addresses. The same descriptor hash was independently
obtained from the server during the earlier audit; this probe does not inspect
the server again.

## First-press mapping

1. `ReadFrameInput` consumes newly received button transitions and accumulates
   primary/secondary down edges. It requests the engine's presented-frame
   snapshot and appends a frame record, or reuses the last record when its frame
   identity matches. With neither a new frame nor an edge, it can return.
2. A down edge sets its attack-start history index only while that index is
   unset. Subsequent edges do not replace the first selected index. The selected
   record carries separate render and player tick/fraction pairs.
3. `CreateMove` serializes those records into `CSGOUserCmdPB.input_history`.
   An optional reduction path for more than four records remaps the attack
   indices; invalid indices become minus one. The serialization helper always
   copies the render pair, while a prediction-state flag gates the player pair.
   This inspection does not observe either runtime setting.
4. The earlier server evidence shows that a valid attack index selects the
   entry's player pair. The resolver converts its tick domain and clamps it
   between current time minus three ticks and current time plus one tick.
   Fallback and cached timing paths remain separate. Static client evidence
   cannot identify which resolver branch a retained demo shot used.

Evidence IDs CH01–CH03 and CH08 cover the input/parser/serialization layers.
CH04–CH07 cover the cross-module frame source; CH09 covers time conversion.

The client obtains the snapshot through the factory-bound
`Source2EngineToClient001` interface. Registration and RTTI link its getter to
`CEngineClient`. That getter copies the latest successfully published snapshot
from a ten-slot ring. `CRenderDevicePresentCallbackClientServer` publishes a
frame payload and callback timestamp through the render-device `Present` path.
A contended publisher can skip publication, so this is not proof of the latest
physical scanout. The payload contains a frame identity, the network-client
render pair and a distinct player pair.

## Player-clock rule

The player pair is forwarded through `Source2Client002` to
`Source2ClientPrediction001`. Let `P` be the cached predicted integer tick, `G`
the global integer tick, `F` the global fractional clock and `D` the global
frame-time scalar. The getter used for the presented snapshot enables fractional
time:

| Condition | Player pair |
|---|---|
| `P > 0` and `D != 0` | Normalize `(P, F)` |
| `P > 0` and `D == 0` | Normalize `(P, 0)` |
| `P <= 0` | `(G, 0)` |

An ordinary fraction in `[0, 1)` is unchanged by normalization. Seconds are the
float32 sum of `float32(tick) / 64` and `float32(fraction) / 64`, with native
float32 rounding at both products and the sum. Special nonfinite inputs are
outside this bounded inspection. The complete prediction scheduling loop was
not reconstructed; the table identifies the getter's inputs and branches, not
their values at a particular captured frame.

## Implementation boundary

A trainer analogue would need the player/simulation clock associated with its
last presented frame, separate from both the shot deadline and current camera
sampling time. A DOM event timestamp or an X11 edge timestamp does not supply
that saved native frame clock. Browser animation-frame delivery is also not
proof of native presentation completion. Replacing a camera anchor with the
scheduled shot time, or fitting a constant millisecond offset, therefore remains
unjustified by this evidence.

The retained recordings lack the following state needed to validate the phase:

- Each relevant present's frame identity, render/player pairs, publication
  timestamp and order, and publication success.
- Each input read's newly consumed transitions, consumed input index, selected
  frame and first-press history index.
- The cached predicted tick, global tick/fraction/frame-time, prediction state
  and phase when constructing that frame.
- The history before/after optional reduction, its active setting and final
  attack index.
- At shot resolution, the exact/fallback branch, tick-domain conversion, clamp
  result, cached difference and camera sampler's current clock.

No runtime default, per-shot branch, prediction phase, display latency or
rendered parity is claimed. The core ordinary first-press mapping is resolved;
special paths, complete history reduction and render-backend completion remain
bounded limitations. Production behavior stays unchanged.

## Reproduction

Use Python with the retained `native-audit/python` packages (`capstone`,
`pyelftools`, `protobuf`) and the matching installed client/engine files. Defaults
are resolved from the probe's location, so it can run from any working directory:

```sh
python3 tools/reaudit-client-history.py
python3 tools/reaudit-client-history.py --portable-out docs/evidence/reaudit-client-history.json
```

Those example command paths assume the repository working directory; an absolute
probe path also works from elsewhere. `--audit-root`, `--game-root` and `--out`
override the local inputs/output. Explicit relative CLI paths are relative to the
caller. By default only local raw evidence is written under
`native-audit/reports/reaudit-client-history`; `--portable-out` explicitly requests
the sanitized JSON. The probe starts no game, analysis service, browser or build.

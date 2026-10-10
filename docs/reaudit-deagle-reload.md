# Current Deagle reload events

The Deagle normal-reload resource mismatch identified in pass 36 changes two
event markers. The current clip plays magazine-removal audio at frame 10 rather
than frame 4 and ends its silent-reload window at frame 50 rather than frame 49.
At the verified 30 Hz authored rate, those are 333.333 ms instead of 133.333 ms,
and 1.666667 s instead of 1.633333 s of animation work.

## Primary evidence

The installed VPK directory and the selected normal reload, empty reload and
Deagle graph resources are freshly read; computed CRCs match the package entries.
The normal compiled resource has SHA-256
`3966fb59252703eaf905a5cbda2c0c778a2837f0ab27e14a819a155a14ff8f3e`.
Fresh Source2Viewer exports are retained with the exporter hash and commands.
After normalizing only source-path separators, the complete decoded normal clip
diff consists of the two markers above. The empty-reload clip is unchanged.

A separate DMX comparison checks all 520 elements, 128 channels and 8,688 keys,
including element attributes and references. It ignores exporter-generated UUIDs
only. Every compared value equals the import-era export; duration remains 2.2 s
at 30 Hz. Therefore this finding does not call for rebuilding the weapon mesh,
arm skeleton or reload motion. It does not independently certify the final
assembled trainer pose.

The freshly decoded Deagle graph has four normal/empty reload ClipNodes, each
with rate 1, no connected dynamic input, zero start-sync offset and no looping.
The source proof preserves the complete clip events and these graph checks.
The existing native Arms clock evidence applies to this ordinary graph path;
this pass does not newly measure graph onset or runtime event consumption.

## Trainer measurements and correction

The reproducible bench executes the actual `NativeReloadState` and
`ActionSoundTimeline` consumers, using both the compiled hearing metadata and
the browser audio manifest. It covers seven common weapons, partial/empty
magazines, normal/held/released reload inputs and both timeline sources: 84 cases.
Both sources agree in every one of their 42 paired cases.

| Deagle normal reload | Before | After |
| --- | ---: | ---: |
| Magazine-removal cue, ordinary reload | 133.333 ms | 333.333 ms |
| Magazine-removal cue with R held | Played before silence | Suppressed inside silence |
| Authored silent-window end | 1.633333 s | 1.666667 s |
| Held silent-mode exit, existing trainer clock | 3.066667 s | 3.133333 s |
| Held completion, existing trainer clock | 3.639057 s | 3.672054 s |
| Ordinary ammo insertion / completion | 0.766667 / 2.2 s | Unchanged |

The six changed cases are the normal Deagle clip under three input patterns,
once for each timeline consumer. All 78 other cases remain identical, including
all empty Deagle reloads and the six other weapons. Releasing R after silence
begins does not replay the skipped magazine-removal cue. Ammo insertion, normal
completion, other cues, sample files and sound levels remain unchanged.

Only Deagle normal-reload metadata changes. The native event boundary is directly
established; the displayed held completion values are predictions of the existing
trainer clock, not fresh native runtime measurements. Its hold delay, slow rate,
released tail, action onset and event-consumer ordering were not re-established
by this resource comparison.

## Retained evidence and reproduction

- `tools/reaudit-deagle-reload-motion.py --audit-root <native-audit>` compares the
  import-era and newly decoded DMX data without UUID-based false differences.
- `tools/reaudit-deagle-reload-source.mjs --audit-root <native-audit>` reads the
  current package bytes and verifies fresh clip/graph data. `--apply` updates
  only the normal Deagle reload in the two tracked metadata files and the local
  browser audio manifest.
- `tools/reaudit-deagle-reload.mjs --repo <checkout> --output <new-json>` measures
  actual consumers before and after; it refuses to overwrite retained runs.
- `docs/evidence/reaudit-deagle-reload-{source,before,after,comparison}.json`
  contains sources, boundaries, all cases and comparison hashes.
- `docs/evidence/reaudit-deagle-reload-assets.json` pins the tracked data and
  private browser manifest before/after hashes for deployment.

Fresh exports live under `native-audit/reports/deagle-reload-next/fresh`.
Decode the normal/empty `.vnmclip_c` resources and
`animation/graphs/viewmodel/viewmodel_gun.vnmgraph+deagle.vnmgraph_c` with
Source2Viewer's `-i <pak01_dir.vpk> -f <selected paths> -o <fresh folder> -d`.
Use the required memory/swap caps and serialize native exports and probes.
The package hash binds the installed resource version; a changed package requires
new evidence rather than weakening assertions.

The browser manifest is a gitignored deploy asset. This follow-up was developed
in an isolated checkout with a private manifest copy, keeping the six commits
through `bfebff8` and their production assets unchanged while push approval is
pending. Before deploying this correction, copy the verified private manifest
into the main asset tree and verify its recorded SHA-256; the deploy job mirrors
that file. No audio samples or model files need replacement.

## Validation

The 84-case before/after bench passes its source-change, consumer-agreement and
78 unchanged-control assertions. All 65 focused cases across the new Deagle regressions, reload clock, native
reload, sound model, audio and changelog suites pass. The initial test-only alias
mismatch and its recheck are retained. TypeScript and all four targeted Chromium
cases pass. The combined suite has 2,509 distinct passing cases after repairing
missing worktree asset links; only the known absent fallback model remains.
The first normal-reload browser check could skip its forced render under the
60 FPS preset; the fixture now advances render time explicitly and verifies the
frame ran. Both normal and held cases pass with production playback unchanged.
[Validation counts and log hashes](evidence/reaudit-common-pistol-validation.json)
retain the initial runs and rechecks. Delivery remains pending.

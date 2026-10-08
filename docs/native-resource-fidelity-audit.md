# Native resource fidelity audit

This follow-up inspects cached resources, a fresh native CS2 installation,
and their use in SprayLab. It distinguishes resource values from a
running-engine comparison.
No gameplay tuning is changed by this audit.

## Fresh installation verification

SteamCMD downloaded and validated App 730 into `../cs2-game/`: Steam build
25738536, client/server version 2000927, patch 1.41.8.9, Source revision
11087167, version date October 5, 2026. The download was 73,415,653,489 bytes.

- The freshly extracted weapon table has the same SHA-256 as the cached
  export below. All 2,730 comparisons across 35 weapons also pass against
  this installed build.
- The freshly extracted SAS model exactly matches the cached compiled model:
  SHA-256 `90cbf5a56d58f4f3df58ea77137688583336c5daf3762ffb594f3fe046cd05a3`.
- Five fresh clips (AK, AWP, USP and Deagle reloads, plus AWP firing) match
  their cached parsed contents after normalizing only the source filename's
  Windows/Linux path separators. Their event markers are unchanged.
- A native dedicated-server process started, answered console queries and
  exited successfully. It reported `sv_accelerate = 5.5`,
  `sv_accelerate_use_weapon_speed = true`, `sv_friction = 5.2`,
  `sv_stopspeed = 80`, `sv_gravity = 800`, and `sv_jump_impulse = 301.993`.
  This verifies constants, not complete movement behavior.

Steam's graphical sign-in window was reached after supplying missing i386
graphics/runtime libraries in a private mount namespace. The graphical game
client still needs a signed-in Steam session before controlled recordings
can begin. No native gameplay recording is claimed.

## Verified cached evidence

- `research/weapons.vdata`: SHA-256
  `3289d4dba65b1ef3f884c389448c8a6c6db8691442c18a7aaddb28434aaf250d`.
  This matches the build-2000924 provenance in `src/range/game-data.json`.
  All 2,730 primary/alternate numeric and control/ammo comparisons across 35
  weapons passed. Four cached exports have the same hash; these are copies,
  not four independent observations of the native engine.
- 157 cached first-person `.vnmclip` resources were parsed. They contain
  42 `WPN_RELOAD_ADD_AMMO` events, 39 `WPN_DROP_MAG` events, 42 silent-reload
  windows, and three sets of shell-reload intro/loop/outro markers.
- Six compiled agent models were inspected with Source 2 Viewer CLI 20.0.
  Their embedded mesh blocks contain identical `cstrike` sets with 19 hitboxes.
  All 19 bone references can be matched uniquely, case-insensitively, to skin
  joints in each of the six shipped agent GLBs.

The independent local evidence scripts and full reports are in
`../native-audit/` relative to this repository, outside the deployed app.

## Most useful finding: native gameplay hitboxes

The hitboxes live in **embedded MDAT blocks**, under `m_hitboxsets`, rather than
the main model's `DATA.m_refPhysicsHitboxData` array. The latter is empty.
The earlier DATA/PHYS-only inspection therefore missed existing native data.
PHYS ragdoll geometry is a separate resource and is not used as evidence for
bullet hitgroups.

The SAS resource contains the same set in five mesh blocks; the other five
agents have three to five copies each. Every copy across all six agents is
identical. Each entry provides a bone name, local endpoints/bounds, shape type,
radius, surface, hitgroup ID, and hitbox index. For example, `head_0` has group
1, shape type 2, radius 4.3 Source units, and local endpoints `[-1, 1.8, 0]`
and `[3.5, 0.2, 0]`. It is not equivalent to the trainer's current head sphere.

The geometry and source hashes are preserved in `native-hitbox-evidence.json`.
Remaining implementation work:

1. Verify bone-local coordinate conversion and endpoint/radius interpretation
   against the exported skeleton and rendered poses.
2. Transform shapes with the actual displayed skeleton, including turning,
   crouching, weapon pose, and partial animation updates.
3. Preserve displayed-frame timing, live armor/health and respawn isolation.
4. Verify native damage treatment for every group, including the neck's ID 8;
   the current trainer has only head/chest/stomach/arm/leg categories.
5. Compare native/debug trace results where available before claiming parity.

## Reload and bolt timing

Clip markers provide more detailed evidence than weapon-level attack-lock
duration. Selected DMX exports confirm a nominal 30 Hz authoring timebase
(minor float rounding is present):

| Resource | Native event frame | Approximate source-clip time | Current weapon attack lock |
| --- | ---: | ---: | ---: |
| AK `reload_ak` add ammo | 33 | 1.10 s | 2.466667 s |
| AWP `reload_awp` add ammo | 60 | 2.00 s | 3.666667 s |
| USP `reload_pistol` add ammo | 27 | 0.90 s | 2.20 s |
| Deagle `reload_deagle` add ammo | 23 | 0.7667 s | 2.20 s |

These are authored event positions, not yet verified wall-clock deadlines.
Active animation-graph branches, playback rates, empty reloads, silent reloads
and interruption behavior can affect gameplay interpretation. In particular,
inserting ammo and allowing the next attack are separate concepts.

The fresh `viewmodel.vnmgraph_c` provides concrete evidence for the playback
rate caveat: its `weapon_action_speedscale` control parameter is connected
to the final Speed Scale node's Scale input before the pose output. A clip's
frame number alone therefore cannot establish its elapsed gameplay time.

The AWP firing clip contains bolt-back and bolt-forward sound events at frames
18 and 26 (about 0.60 and 0.867 seconds of source-clip time). Its 1.6-second
animation duration also differs from the 1.455-second weapon firing interval.
Replacing firing cooldowns with full animation durations would be incorrect.

The existing audio importer consumes sound events and shotgun phase windows.
It does not export `WPN_RELOAD_ADD_AMMO` to the gameplay reload controller;
magazine ammunition currently commits at the weapon's attack-lock completion.

## Additional fields and their use

| Native detail | Existing implementation | Follow-up |
| --- | --- | --- |
| Primary/alternate movement speeds, spread, recoil parameters, recovery and scope timings | Imported and matches the cached native data | Validate how the engine combines them over time |
| `m_flInaccuracyLadder` | Not imported into `game-data.json`; firing accuracy has no ladder-specific input | Trace the native combination with other accuracy terms |
| Negev `m_flAttackMovespeedFactor = 0.5` | Movement uses the ordinary weapon speed; no use of this factor found | Establish when the native firing-state modifier starts and ends |
| SG 553/AUG iron-sight pull-up/down, pivot and looseness fields | Not imported; scope FOV switches immediately | Reconstruct the native transition, not just the final FOV |
| `m_flFlinchVelocityModifierLarge/Small` | Already imported separately in `tagging-data.json` | Not a missing-data finding |
| `m_flInaccuracyReload = 0` for all 35 entries | Omitted | No nonzero missing behavior demonstrated by this field |
| Negev pitch-shift and alternate-sound threshold | Not imported | Determine audio semantics before interpreting these as aim pitch |

## Camera, movement and tapping limits

`view-recoil.ts` still uses estimated camera and weapon fractions of 0.45 and
0.22. Native animation clips alone do not establish these values. The renderer
also layers generic kick and bob over the imported animation.

Movement/recovery evidence spans several builds: acceleration fixtures are
from 2000919; weapon tables from 2000924; cached agent/action manifests from
2000927; the retained punch/recovery provenance starts at 2000908, with later
scoped verifications documented separately. These labels must not be combined
into a claim of complete current-build parity.

The old audit references `research/convars.txt`, but that file and the original
Windows client/server libraries were not included in this workspace's archive.
Fresh Linux libraries are now installed. The existing Windows-binary emulation
scripts cannot be rerun against new Linux binaries by reusing old offsets.

Recovery parameters are inputs to a decay formula. For example, a standing
recovery value of 0.368 does not mean the AK becomes perfectly accurate exactly
368 ms after every shot. Recoil index, stance, movement and the native update
schedule also matter.

## Local recording setup

The host is Ubuntu 22.04, Ryzen 5 7640HS / Radeon 760M, approximately 29 GiB RAM,
with roughly 671 GiB free before downloading CS2. Its active X11 display is
1920×1080 at 60 Hz. The native AMD Vulkan device is accessible through RADV.

Portable SteamCMD and FFmpeg were prepared in `../native-audit/`; no system
packages were installed or upgraded. FFmpeg encoded a 120-frame synthetic
clip successfully and supports capturing an individual X11 window.

Game download/validation, a server console probe, and selected fresh-resource
comparisons are complete. Graphical client verification and actual CS2
recordings remain separate checks. A native client run on this Linux
host cannot establish click-to-photon latency on the user's Windows/RTX 4090
machine. Ordinary screen capture also cannot measure the physical input or
monitor scanout portions of that latency.

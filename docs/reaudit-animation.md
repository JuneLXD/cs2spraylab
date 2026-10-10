# Independent model and animation re-audit

Baseline: `c488943`. Primary assets: installed CS2 client 2000930, fresh exports on 2026-10-09. No gameplay, animation or cosmetic tuning was made merely to reduce an unexplained discrepancy. “Matched” below is restricted to the measured property; importing native clips does not reproduce the native animation graph.

## Reproducible bench

Run from the repository, prefixing every Node command with `systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0`; add `-p CPUQuota=100%` for numerical probes and `-p CPUQuota=400%` for browser captures.

1. `node tools/reaudit-animation.mjs --export` exports primary graph, clip and skeleton evidence with the installed Source2Viewer. `CS2_PATH` and `SOURCE2VIEWER` override the local paths. Evidence stays in `research/reaudit-animation/`; the provenance file identifies the VPK listing and model hashes.
2. `node tools/reaudit-animation.mjs` samples every original channel keyframe and inventories all 37 supported viewmodel IDs. The committed `tools/reaudit-animation-results.json` records numerical errors, durations, material summaries, mesh counts and asset hashes.
3. `node tools/reaudit-animation-pose.mjs` evaluates global poses at 30 Hz plus each exact clip endpoint, compares the actual shipped skeleton and mounted weapon parts, and skins every body vertex at 18 poses. Results: `tools/reaudit-animation-pose-results.json`.
4. `node tools/reaudit-animation-charge.mjs` independently decodes the R8 graph composition using DMX deltas over `shoot1` frame zero; it compares before/after arms, fingers and weapon parts and generates the runtime regression fixture. Results: `tools/reaudit-animation-fix-results.json`.
5. `node tools/reaudit-animation-graph.mjs` inventories 204 fresh graph exports, 158 clip metadata exports, referenced-but-unselected view actions and native event tracks. Results: `tools/reaudit-animation-graph-results.json`.
6. Once repository edits and other browser work stop, `node tools/reaudit-animation-strip.mjs --base http://192.168.0.18:5176 --mode world --action run_e_rifle --frames 12 --step 0.0666667` renders the native clip beside the actual trainer animator. For first-person actions use `--mode view --weapon ak47 --action reload` (or `fire`, `draw`, `inspect`). It advances explicit timestamps and saves screenshots plus world-space landmarks. Native panes show exported clips with neutral materials, not captured Source 2 rendering. View panes intentionally show arms only. `tools/contact-sheet.py` assembles strips.

## Measurements before changes

The first bench compared 90 native world clips and four independently refreshed flinches, totaling 419,310 channel samples. All 90 world clip durations match exactly; no channels are missing. Maximum local translation error is **0.144 mm**, and maximum local rotation error is **0.02383 degrees**. Four retained flinch rotation sets preserve duration and differ by at most **0.03189 degrees**. This is consistent with lossy keyframe reduction, not a different authored animation.

The view bench compares **37 absolute clips** across AK-47, AUG, Glock, AWP, R8 and Nova. Across **2,206 frames**, maximum sampled global bone-position error is **1.330 mm** (R8 idle). Nonconstant clip durations differ by at most about **34 microseconds**. Six native static poses with zero duration become constant 33.333 ms loops; they do not acquire motion. The 37 sampled absolute clips remain within 1.8 mm of the independently derived native part positions. R8 charge is an additive graph layer and is measured separately below; comparing it directly against a bind-composed export does not establish correct runtime pose.

Six world clips—standing idle, crouched idle, forward walk, right run, right crouch and standing jump—cover **94 frames**. Maximum sampled bone-position error is **0.258 mm**. Transforming all 19 hitbox capsules through fresh-native versus shipped posed bones yields maximum endpoint discrepancy **0.230 mm**. This compares animation/skeleton conversion, not independent correctness of the capsule definitions; the combat bench separately checks their MDAT values.

The third-person SAS body is simplified from **19,077 to 9,779 vertices**. The entire skinned body envelope differs by at most **0.052 mm** across the 18 sampled poses. Small envelope differences do not prove vertex/weight identity or facial silhouette equality. First-person AK arms similarly reduce 7,360 to 6,521 vertices and sleeves 1,954 to 1,935. Fresh-native and shipped skeletons retain 94 character joints.

## Verified R8 charge composition correction

The native revolver graph's `PrimaryFire0` layer blend uses a state machine as its base and `Charge` as an additive local layer. The initial `Charge` state contains a fixed animation-pose node for **`shoot1_revolver` at time zero**. The charge clip's metadata declares `RelativeToFrame / FirstFrame`; its hand and forearm deltas remain identity while fingers, hammer and trigger move. Source2Viewer's `--gltf_compose_additive` instead produces an absolute clip composed onto the skeleton bind pose. Playing that export directly as the charge pose makes the arms hang down while the gun remains near its firing location.

`tools/native-view-charge.mjs` now rebases those deltas onto the graph's firing-start pose before Blender assembles the viewmodel. The raw export is retained separately, and inventory metadata records the native source hash and composition reference. `art/build_reload.py` also retains constant object animation channels so a clip cannot silently inherit another action's weapon-armature mount. HD and legacy R8 assets were rebuilt.

The independent bench does **not** call the production composition helper: it reads separately decoded native DMX deltas, applies them to the fresh native firing-start skeleton, and derives weapon part transforms as `primary wpn world × inverse secondary weapon bind world × secondary part world`. Across **30 frames and 450 landmarks per asset**, maximum arm/finger position error changes **752.262 mm → 0.02743 mm**; maximum compared rotation error changes **131.139° → 0.01357°**. The five measured weapon landmarks differ by at most **0.0001763 mm** after rebuilding, versus **0.97245 mm** before. These are pose conversion measurements, not claims of matching live charge timing.

The earlier mount-only investigation found a 124.647 mm difference against the bind-composed export and retained constant mount channels, but that reference omitted the graph base and incorrectly accepted hanging arms. That conclusion is superseded by the graph-composed bench. `src/range/native-viewmodel-mount.test.ts` now loads the actual HD/legacy GLBs and checks both forearms, upper arms, hands, three trigger-finger joints, `wpn`, and five weapon landmarks at six charge times, then repeats after firing and cancellation. Position tolerance is 0.1 mm and rotation tolerance 0.05°. `REAUDIT_VIEWMODEL_ASSET_DIR=research/reaudit-animation/before` reproduces the original-asset failures.

`node tools/reaudit-animation-strip.mjs --mode mount --weapon revolver --action sequence --frames 25 --step 0.05` renders both original and rebuilt assets through the actual `ViewAnimation`: idle, charge, fire, cancel, second charge, cancel. Blue is the original runtime assembly on the left; gold is the trainer runtime on the right. It saves `frames.json` for contact sheets plus bone landmarks in `samples.json`.

The controller still compresses the 0.9667 s charge clip into the mechanical 13/64 s windup and holds its endpoint. The authored hammer movement reaches its plateau around 0.3 s, and the exported graph clip node has speed 1. A live native R8 charge trace or verified client parameter is still required to establish active playback timing; this change fixes the evidenced pose composition without guessing a new rate.

## Full presentation inventory

Before and after are identical except for the R8 charge composition and mount preservation above. “Not present” means no corresponding runtime behavior was found in the named implementation, not that the game lacks it.

| Mechanic | Primary rule/evidence | Trainer before → after | Status | Implementation commit |
|---|---|---|---|---|
| Agent mesh, scale and proportions | Fresh `ctm_sas.vmdl_c` glTF, world pose and skinned-envelope bench | Simplified SAS body; measured envelope ≤0.052 mm, bone position ≤0.258 mm; unchanged | Approximated mesh; matched sampled scale/pose | `c488943` |
| Skin weights and all six agent variants | Native skinned meshes retain per-joint inverse binds; each variant must be compared to its own model | 94-joint SAS rig verified; other five variants not freshly skin-sampled | Unverified outside SAS sample | `c488943` |
| Agent materials, textures, cloth and specular | Native model/material/shader resources | glTF PBR/Three rendering, compressed textures; no cloth solver or Source 2 shader recreation | Approximated | `c488943` |
| Gloves, knives and finishes | Native glove/weapon meshes and composite-material resources | Glove builder collapses fixed attachment helpers, uses approximate albedo and metallic .05/roughness .65; finishes use browser shader approximations | Approximated; per-finish rendering unverified | `c488943` |
| Mesh LOD | Native model supports authored mesh/LOD resources | One optimized mesh per loaded asset; no native distance LOD selection identified | Not present as native LOD | `c488943` |
| Posed hitboxes: stand, walk, crouch, jump | Fresh skeletal poses plus 19 capsule transforms | ≤0.230 mm endpoint difference across six sampled clips; capsules follow rendered skeleton | Matched sampled transform; full runtime graph approximated | `c488943` |
| Head/neck boundary | Native capsules are separate head and neck groups | Existing definitions transform correctly with those bones; combat independently checks source shape/group | Matched sampled transform | `c488943` |
| Dying poses and hitboxes | Native death/ragdoll graph transitions | Dead actors cease active target damage; custom physics poses corpse | Approximated | `c488943` |
| Eye height versus head | Model head bone is an animated landmark, not authoritative camera height | Camera comes from movement eye-height rule; pose bench does not establish live camera trajectory | Unverified relationship; movement bench owns eye rule | `c488943` |
| First-person arms scale and pose | Fresh view clips and native character skeleton | 37-absolute-clip/2,206-frame sample; R8 charge separately graph-composed, maximum global bone position error 1.330 mm | Matched within reported conversion error | `c488943` |
| First-person placement, FOV and stretched resolution | Live configured camera and viewmodel projection required | Separate viewmodel camera, Source-unit offsets and stretched aspect handling remain | Unverified complete visual parity | `c488943` |
| Eight-way run/walk/crouch | `worldmodel_locomotion.vnmgraph`: eight directional clip sets; standing anchors 136/225 u/s, crouch 96 u/s | Rifle/pistol sets retained; zero missing channels in 90-clip comparison | Matched clip data; approximated blending | `c488943` |
| Locomotion speed and idle rate | Graph blend-space coordinates and idle multiplier .167 | Same scalar anchors and idle multiplier; directional radial interpolation and phase locking are custom | Approximated graph; matched named constants | `c488943` |
| Planted-foot reversals | Native graph references start, slow, cross-leg and e2w/w2e states | Two planted clips exist in pack but runtime weights never select them | Not present | `c488943` |
| Turn in place | Native world graph and locomotion state transitions | Actor root turns; no native turn-in-place state machine selected | Not present | `c488943` |
| Jump, in-air, crouched air | Native authored jump/in-air clips | Retained clips blended with custom takeoff 60% threshold and .12 s blend | Approximated | `c488943` |
| Additive takeoff and landing | `worldmodel.vnmgraph` references standing/crouched `jump_additive_*` layers for rifle/pistol/knife | No corresponding additive runtime layer | Not present | `c488943` |
| Aim matrix and IK | Native world graph aim/bone-mask/IK nodes | Estimated pitch weights spine0 .20, spine1 .30, spine2 .35, head .15; clamp ±1.15 rad; .35 share while reloading | Approximated | `c488943` |
| Weapon families: rifle/pistol/knife/grenade/heavy | Native world graph has separate knife, pistol, rifle locomotion and weapon graphs | Pistol equipment selects pistol; all other equipment selects rifle; weapon-specific upper-body idles/gestures overlay it | Approximated; knife/grenade locomotion absent | `c488943` |
| World draw/reload/fire gestures | Native world DMX channels and additive metadata | Native upper-body subset; lower-body/root tracks dropped, spine/neck/head translation dropped at runtime; durations retimed to mechanic | Approximated composition/timing | `c488943` |
| Hit flinch by group and side | 90 VPK flinch entries = 45 base + 45 non-additive variants | 42 bullet-hit family clips imported; three molotov family clips omitted; four freshly sampled retained sets match to .03189° | Matched sampled clip deltas; approximated blending | `c488943` |
| Death and ragdoll behavior | Native world graph hands death to native physics | Custom joint spheres, distance constraints, damping .98/friction .45, 10 iterations; baked fallback | Approximated | `c488943` |
| Distance-based animation throttling | Needs native client runtime measurement | Trainer uses visibility and global quality/adaptive rate; no distance input in `animationRate` | Native rule unverified; distance-specific policy not present | `c488943` |
| View draw, idle, fire, reload, empty reload, inspect | Fresh selected view clips and graph references | Imported common actions; six-weapon sample durations/poses preserved within reported errors | Matched sampled assets; approximated runtime transitions | `c488943` |
| Last-shot/scoped/left/right/alternate variants | Fresh view graphs; selector inventories | Supported dedicated last/scoped/Dualies/R8 variants; generic fire paths use selected native shoot1 clips | Matched selection for implemented variants; full graph not reproduced | `c488943` |
| View action coverage | Referenced resources in fresh graphs | Unselected referenced actions include AK inspect variants/fixups, AUG/SG fidgets, CZ second reload/draw, MG bullet-hide layers, R8 chamber-position layers and knife hit/backstab variants | Not present for named layers/actions | `c488943` |
| Settle and action interruption | Native graph transition durations, sync events and inspect fixups | Trainer fades transient end over up to .08 s; inspect onset .06 s; fire resets transient; reload/switch cancels it | Approximated; exact event gating unverified | `c488943` |
| R8 charge/dry fire | Fixed `shoot1` frame-zero graph base plus additive `prepare_shoot`; independent DMX delta reference | Arm/finger error 752.262 mm → 0.02743 mm; HD/legacy rebuilt; regression checks hands and weapon after idle/fire/cancel | Matched sampled graph-composed pose; charge playback rate and chamber layers unverified | `9b94483` |
| Bolt, slide and pump | Secondary skeleton animation embedded in native fire/reload clips | Included in exported rigged weapon clips; separate clip is not required for AWP/SSG bolt; sampled part errors ≤1.8 mm after R8 fix | Matched sampled parts within conversion error | `c488943` |
| Shell reload timing | Native segment markers and clip times | View/world reload windows are selected by mechanic phase, then blended | Approximated composition; combat bench owns deadlines | `c488943` |
| Viewmodel recoil share/view punch | Current-byte caller chain and native .325 world-angle addition; 432 bounded executions | Rotation error 3.29584° → 0.000014502° across 108 supplied states | Isolated rotation corrected; full gun/camera trajectories remain open | Pass 23 |
| Bob/sway and crouch/zoom motion | Native HUD-model procedure contains motion outside the graph | Existing 2 mm sine bob and other approximations retained | Native absence claim overturned; full procedural parity unverified | Evidence in pass 23 |
| Muzzle shape, size, duration | Fresh fire event tracks reference per-weapon particle systems at frame zero | Reduced native texture/particle envelopes grouped into six families; implementation explicitly approximates radius, randomization and materials | Approximated | `c488943` |
| Shell ejection | AK fire clip includes `weapon_shell_casing_rifle` event at frame zero | No ejected shell/casing simulation/rendering found | Not present | `c488943` |
| Tracer cadence and shape | Native per-weapon tracer data and particle systems | Native cadence option plus every-shot training option; browser trail/rope approximations | Approximated shape; combat/data bench owns cadence | `c488943` |
| Gun smoke | Native particle graph hierarchy | One simplified expanding/fading sprite per muzzle slot | Approximated | `c488943` |
| Scope overlays and unscoped blur | Native runtime scope rendering required | Browser scope effect implemented; no independent matched-frame rendering comparison | Unverified | `c488943` |
| World weapon attachment | Native `wpn` and secondary weapon skeleton | Native hand/anchor transforms plus procedural aim correction; secondary part bench checks mounted pose separately | Approximated runtime aim; measured clip mounts | `c488943` |
| World weapon moving parts when bots fire/reload | Native weapon skeleton action layers | `attachWorldWeapon` clones a static model under `wpn`; the only bot mixer binds character gestures, with no secondary part tracks | Not present | `c488943` |
| Dropped weapons | Native dropped world models and physics | Trainer pickup/drop presentation uses browser scene and simplified placement | Approximated | `c488943` |

## Earlier claims narrowed or corrected

- The earlier description of “distant animation sampling” is too specific. `DuelEngine.updateActors` applies a visibility gate and `FrameMetrics.animationRate(quality)` globally; the current rate function has no distance input. Do not claim native distance throttling is implemented.
- “Native animations” is true of the measured imported clip data. It is not evidence that the native graph, aim matrices, planted transitions, jump/landing additives, IK, masks, or event-driven transitions are reconstructed. Existing documentation already acknowledges the graph boundary; this bench quantifies the asset side independently.
- “90 flinch entries” is a VPK-resource count, not 90 unique bullet-hit gestures. It includes paired non-additive variants. The 42 imported bullet-hit clips exclude the three molotov-family base clips; importing all 90 would double-count representations.
- “Native model” does not mean identical meshes or shaders: the measured target body has 9,779 vertices versus the current export's 19,077. Tiny sampled skinned-envelope error does not establish material, topology or every silhouette equivalence.
- Native zero-duration static poses becoming 1/30 s constant loops is observable but does not indicate a one-frame delayed action. Nonstatic sampled clip timing stays within export timestamp precision.
- The existing assertions that rifle/pistol clip imports, 136/225/96 u/s anchors, .167 idle rate and retained flinch deltas derive from native data are independently confirmed by fresh resources and numerical samples.
- A Blender-space mount report and a final-GLB mount-only check both missed the R8 graph base. The latter measured the wrong bind-composed reference. The replacement regression requires graph-derived arm/hand/finger poses as well as weapon landmarks and rejects the original assets.

## Evidence still required

- Complete native gameplay rendering and graph output still require runtime footage. The paired clip/runtime strips below do not replace it.
- Record native fixed-camera bots doing AD reversal, turn-in-place, crouch/run transitions, jump/land, pitched aim, crouched reload, directional flinch and deaths. Pair each frame with its actual decoded presentation timestamp and command/demo time.
- Capture first-person gun plus world camera landmarks for recoil, landing, zoom and crouch at fixed viewmodel FOV/offsets/resolution. The first recovery video has large PTS gaps; its 60 Hz container header is not a valid frame-time clock.
- Export all six agent variants, every glove/knife/finish family and relevant native materials, then compare posed skin surfaces and rendering under controlled lighting. Current numerical coverage is explicitly SAS plus six representative first-person weapons.
- Inspect the native client animation-rate policy and active graph event consumption before changing distance throttling, inspect gates or additive composition. Graph resources show the ingredients, not proof of the active runtime branch for every configuration.

Implementation commit: `9b94483`. The verified presentation change is the R8 graph-base charge composition and constant-mount preservation; other gaps remain explicitly bounded.

## Integrated visual validation

All four serial strips were rendered from identical camera viewpoints in separate
viewports: R8 idle/charge/fire/cancel 25 frames, world right-run 12 frames, AK reload
14 frames and full AK fire/return 26 frames. All 77 frames completed with no browser
errors. The corrected R8 keeps the hands on the grip through both charges and
returns to the prior idle pose after cancellation. Idle landmark differences
between original and rebuilt rigs remain at most 0.0066 mm; the earlier apparent
idle difference was camera parallax, removed by the paired viewport fix.

World limb phases agree. AK motions agree through their authored portions;
trainer onset/end fades remain bounded differences (reload onset left hand 4.39 mm,
fire endpoint/idle about 0.65 mm). These neutral-material external views validate
skeletal motion, not native first-person projection, recoil or lighting. Results
and sheets are retained in `research/reaudit-animation/strips`; the capture tool
and independent numeric reports are committed.

Final integrated checks: TypeScript passes; 2,227 units pass with only the known
missing fallback-model failure; all 5 Chromium input/trigger/view-punch cases pass.
The deploy mirrors the two gitignored R8 GLBs from `public/revamp/models`; the
release verifier checks their served hashes against these rebuilt files.

Pass 23 supersedes the former unmeasured model-share and no-bob rows: see
[the current native procedural recoil report](reaudit-viewmodel-recoil.md).
Full motion/graph/render parity remains open.

## Pass 29: action clocks, evidence only

The bounded AK/AWP/Nova/XM comparison uses existing build 2000930 package
listing, freshly decoded variation graphs and AK/AWP/Nova view clips. All 20
selected imported clip entries (idle/draw/inspect/reload/fire) still match the
current listing's CRC and byte count. XM's retained clip metadata and assembly
are older exports; matching compiled-resource CRC/size corroborates their
identity, but this pass did not perform a fresh XM decode. SHA-256s identify
each decoded graph/event file and the imported GLB JSON chunks; JSON-chunk
hashes are not whole-asset hashes.

The reproducible probes are `tools/reaudit-animation-timing-metadata.mjs` and
`tools/reaudit-animation-timing-runtime.mjs`. The latter executes the actual
`ViewAnimation` and `NativeReloadState` with linear clock tracks and measured
imported clip durations. It measures action time and weight without a renderer
or mesh load. Full outputs, graph connections and source hashes are retained in
`../native-audit/reports/animation-timing`; the compact snapshot is
`tools/reaudit-animation-timing-results.json`.

| Case | Authored/imported range | Actual trainer clock | Evidence boundary |
| --- | --- | --- | --- |
| AK fire | 0.766667 s | 1× | Four clock samples agree; final 80 ms fade remains a trainer choice |
| AWP fire/bolt | 1.600000 s; bolt sound markers 0.600000/0.866667 s | 1× | Bolt is included in fire, not compressed to the 1.455 s attack cycle |
| Nova fire/pump | 0.800000 s; pump sound marker 0.233333 s | 1× | Pump is included in fire; its 0.880 s attack cycle is separate |
| XM fire | 0.866667 s | 1× | Repeated shots restart the clip; no compression to the 0.350 s cycle |
| AK magazine reload | 2.433333 s clip; 2.466667 s attack lock | 0.986486× ordinary animation clock | Gameplay adds ammo at 1.100000 s; frame-33 animation time arrives at 1.115069 s |
| AWP magazine reload | 3.666667 s clip and attack lock | Approximately 1× | Ammo/animation marker clock difference below 0.001 ms |
| Nova intro/loop/outro | 0.366667/0.433333/0.833333 s | Mapped into 0.500000/0.466667/0.200000 s phases | Rates 0.733333/0.928571/4.166667×; native active-phase duration unresolved |
| XM intro/loop/outro | 0.700000/0.600000/0.433333 s | Mapped into 0.500000/0.600000/0.200000 s phases | Rates 1.400000/1.000000/2.166667×; native active-phase duration unresolved |
| Draw after simulated 250 ms model delay | AK/Nova/XM 1 s; AWP 1.266667 s | 1.333333× or AWP 1.245901× | Actual callers restart clip zero over remaining deploy time; injected delay is not a measured live loading frequency |

Sixteen fire samples have maximum clock error 2.78e-17 seconds. The reload
15.069 ms result is a measured trainer time mismatch with its own ammo event,
not a measured native rendered-hand delay. Sound reload timelines also map
to phase progress; no independent native audio timing claim follows from this
clock-only probe.

The AK graph resolves both partial/empty reloads directly through ClipNode
→ ClipSelector → PoseResult. Each ClipNode specifies speed multiplier 1;
its only input pins are reverse and reset. No temporal rate/duration wrapper
was found in the graph's 459 nodes. Shell graphs use real sync-track boundaries:
while `reload_stage != stage_outro`, the zero-duration transition jumps from
`WPN_RELOAD_OUTRO` to `WPN_RELOAD_LOOP`. Their 200 ms reload-entry and idle-exit
values are transition blends, not proof of an entire native phase's duration.

No production timing change is justified by this pass alone. The remaining AK
boundary is the **current client caller that supplies elapsed time/playback rate
to the first-person NmGraph update**, including ordinary reload initialization,
any outer rate multiplication and action-complete/idle transition timing.
The older build 2000927 silent-gate emulation selected rate 1 for a reload that
never slowed, with helpers shimmed; it does not bind the complete current-build
viewmodel update. The retained demo catalog exposes
`Weapon.CBodyComponentBaseAnimGraph.m_flPlaybackRate`, but its connection to the
first-person NmGraph clock is unproved. A field name alone cannot close that
gap. Only after that caller/field relationship is established should the AK
15.069 ms discrepancy be used as before/after evidence for a narrow correction.

Reproduce from the repository, serially under the host caps:

```sh
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% node tools/reaudit-animation-timing-metadata.mjs
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% node tools/reaudit-animation-timing-runtime.mjs
```

Both tools accept `--out <directory>`. The metadata probe must run first into
that same directory. It requires the retained local research exports and
imported assets; the runtime probe uses the project's existing esbuild/Three
dependencies. Original probes completed in 0.43/0.66 seconds under the stated
caps. This pass launched no game, browser, native-analysis provider or exporter.

Root integration reran both portable copies successfully under the same caps.
Combined delivery validation: TypeScript passes, 2,363 units pass with only the
known fallback-model fixture failure, and both targeted Chromium view-punch
cases pass in 27.3 seconds. Production behavior and assets are unchanged.

## Pass 31: ordinary AK reload clock

The current first-person animation caller closes pass 29's external-rate gap
for the ordinary AK reload. `ViewAnimation` now samples AK magazine reloads at
their authored seconds, capped at the imported endpoint. The mechanical
reload clock, ammo insertion, firing readiness, action onset and existing
blends are unchanged. The last approximately 33.333 ms of the mechanical lock
holds the authored endpoint while the existing tail fade continues. Other
weapons, draw, fire and shell timing are unchanged.

The primary native source is build 2000930 `libclient.so`, SHA-256
`eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1`.
`tools/reaudit-animation-clock-native.py` verifies that whole-file digest,
35 instruction assertions, four RTTI class identities, six virtual targets
and the tick conversion constant. Both the inline and queued AG2 workers
obtain the same entity elapsed-time value before updating the graph context
and evaluating its pose. Their post-evaluation virtual callback resolves to
`C_CS2HudModelArms::AG2_PushAnimTransformsToSkeletonInstance`; this is the Arms
graph chain, not an inferred relationship from a similarly named weapon field.

For Arms, the owner-clock override gate returns false. Its graph clock selects
the entity-domain tick; domain zero applies the game-rules pause adjustment.
The controller stores that selected tick and advances by
`max(previousTick == 0 ? 1 : selectedTick - previousTick, 0) / 64` seconds.
The update context stores that elapsed value unchanged before the graph-root
update. Neither the mechanical reload lock nor a legacy sequence playback-rate
value multiplies this path. This establishes the steady **1× graph clock
against unpaused game ticks**, independently of render cadence.

A bounded private native replay executes tick selection, pause accounting,
the Arms gate, stored-tick mutation, clamping, conversion and the context delta
write. All 40 cases match exactly: first update, ordinary advance, repeated
tick, rewind, missed ticks, zero first tick and two pause-domain cases, each
with five independent synthetic legacy-rate values. Only controller/owner
object lookup is shimmed. These are supplied-state native executions, not
observations of a live reload. The portable result is
`docs/evidence/reaudit-animation-clock-native.json`.

`tools/reaudit-animation-clock-graph.mjs` independently reparses the retained
current-build AK graph and decoded reload event resource. It asserts all four
partial/empty reload paths: ClipNode speed 1, no connected dynamic inputs,
zero start-sync offset, no looping or variation override, and direct
ClipNode → ClipSelector → PoseResult output. The reload entry has a 200 ms
blend and `MatchSyncEventID`, but its target switch selects an empty ID for
ordinary reload; only `reload_stage == stage_outro` selects
`WPN_RELOAD_OUTRO`. All ten AK event tracks are non-sync tracks and contain no
reload-loop/outro markers. The three graph layer settings are unsynchronized.
The exact graph/resource hashes and compiled clip listing CRC/size are retained
separately in `docs/evidence/reaudit-animation-clock-graph.json`; a decoded
resource hash is not a compiled-asset hash. No new extraction was required.

The updated runtime probe finds the event crossing by bisecting actual
`ViewAnimation` action-time samples, rather than presuming a duration ratio.
Both before and after runs use `NativeReloadState` and imported GLB durations:

| Measurement | Before | After |
| --- | ---: | ---: |
| AK clip time at 1.1 s of ordinary reload work | 1.08513501685 s | 1.10000000000 s |
| Frame-33 pose crossing from the trainer action clock | 1.115068614703 s | 1.100000000000 s |
| Crossing minus the 1.1 s gameplay ammo event | 15.068614703 ms | below 0.000001 ms |
| Mechanical reload lock | 2.466667 s | 2.466667 s |
| Ammo at the insertion event | 30 | 30 |

The measured crossing bracket is narrower than 1e-10 seconds in each run.
All 60 other clock-probe rows are identical, including AWP insertion, draw,
shell phases and 16 fire samples (maximum authored-clock error 2.78e-17 s).
`docs/evidence/reaudit-ak-reload-clock.json` retains the compact before/after
rows, both crossing brackets, source hashes, probe hash and checks. The
unchanged before source hash is
`d2eca9451940d34fb75014fa20bf34d4a7e460b733ca06349bd6f546d96c5adc`;
the complete retained before result hash is
`3d190405cd2a947f9f38d5b730e5dcba2004e8c1b9f5b1e7f07bf8ea87263cbd`.
Full local runs are under
`../native-audit/reports/animation-clock-trace/runtime-clock-{before,after}.json`.

Focused regressions evaluate synchronized hand and weapon bone tracks through
the real mixer and reload controller. Partial and empty reloads reach the
insertion pose with the ammo update; onset fade, endpoint hold, tail fade,
readiness and completion remain covered. Other magazine weapons and legacy
callers retain proportional sampling. Four new test cases and four changelog
cases pass; integration/browser validation is recorded by the main audit.

**Remaining boundary:** native first-active reload sample, empty-sync-target
fallback, transition phase and absolute displayed onset are still unmeasured.
This change removes a proportional clock slowdown; it does not fit or claim
an exact native hand/display offset. The native Arms clock proof does not
enumerate every other viewmodel entity's clock branch. Full skeleton blending
and reload audio alignment are also outside this correction; the audio
timeline and existing presentation blends are preserved. Native held/silent
reload mapping is not newly certified by these ordinary-reload comparisons.

Reproduce serially from the repository under the host caps:

```sh
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-animation-clock-native.py --portable-out docs/evidence/reaudit-animation-clock-native.json
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% node tools/reaudit-animation-clock-graph.mjs
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% node tools/reaudit-animation-timing-runtime.mjs
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-ak-reload-clock-report.py --after ../native-audit/reports/animation-timing/runtime-clock-results.json
systemd-run --user --scope --quiet -p MemoryMax=2G -p MemorySwapMax=0 -p CPUQuota=100% npx vitest run src/range/view-animation-ak-reload.test.ts src/range/changelog.test.ts --maxWorkers=1
```

The native replay requires the retained native-audit Python dependencies and
matching local client binary. Resource checks require the retained graph/event
exports and listing. The timing probe consumes pass 29's metadata output;
regenerate it with `tools/reaudit-animation-timing-metadata.mjs` if absent.
The report requires the hash-pinned historical before result and the new after
result. No game, browser, exporter or native-analysis provider was launched by
this pass.


## Passes 30–31 integration validation

TypeScript passes. The full unit suite has 2,367 passes and only the documented
missing `public/models/ak47.json` fallback fixture failure. Both Chromium
camera/viewmodel cases pass. The actual Duel reload case verifies authored
seconds, endpoint hold during the lock, held-work continuity, return to idle
and nonoverlapping HUD controls at three viewport sizes. Its initial run
passed the animation assertions and exposed a stale four-group HUD count;
`DuelStage` contains three groups. The corrected test passes in 9.3 seconds.
Production UI behavior was not changed to accommodate the test.

Native/graph/fixture probes pass, and current source/fixture/probe hashes are
consistent. Heavy jobs ran serially under memory/swap/CPU caps with deploy
paused and all repository edits frozen during browser runs. Logs use the local
`reaudit-controller-ak-{typescript,unit,browser,browser-reload}` prefix.

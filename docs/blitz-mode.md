# Blitz: Ancient

Ancient uses **BLITZ 2.0 - Ancient**, Refrag set **4530**, live **version 120**, captured from the user's
membership practice server on 2026-10-11 UTC. All **38 arenas, 38 player spawns and 190 bot spawns** are included.
Every arena has one DEFAULT group with five bots. Arena names and order are preserved. This replaces the former
24 procedurally generated arenas.

## Source and reproducibility

The documented [Creator Studio inspection commands](https://wiki.refrag.gg/en/creator-studio) expose the set:

1. Launch [Blitz](https://wiki.refrag.gg/en/blitz) on Ancient, connect using the linked Steam account, and enter `.dev`.
2. `.arenas` reports the set ID, live version and full arena roster.
3. For indices 0 through 37, `.arenas <index>` reports arena metadata and player spawns;
   `.arenas <index> 0` reports every bot's position, facing, direction and widest-swing target.
4. Preserve only the authored arena output, without account identity or server connection information.

The captured input is [`evidence/refrag-ancient-blitz-v120.txt`](evidence/refrag-ancient-blitz-v120.txt).
Regenerate the game data from it with:

```sh
node tools/import-refrag-blitz.mjs docs/evidence/refrag-ancient-blitz-v120.txt
```

On the shared LAN host, run Node commands through the repository's prescribed `systemd-run` memory cap.
The importer rejects missing arenas/bots, extra unhandled groups/spawns, and unsupported movement settings.
It writes `src/range/duel/maps/de_ancient.blitz.json`, with source identity and version attached.
The old `tools/build-blitz-arenas.mjs` remains a procedural authoring tool; do not run it over this captured file.

## Coordinates and movement

- Source `(x, y, z)` becomes game `(y, z, x) × 0.0254`. Spawn coordinates are feet, without an eye-height offset.
  Native `getpos` reports the camera at roughly 64 units above the feet; the captured `.arenas` values are origins.
- Source yaw becomes `yaw + 180°`; Source pitch is negated. Both player and bot facing are preserved.
- The captured bots have zero displacement and peek group zero. There are 94 left swings, 94 right swings and two
  forward swings (in Mid #7 and Mid #8). Swing vectors use each bot's authored yaw, independent of its aim updates.
- Bots wait for the configured schedule, then move in the authored direction. They stop when their captured
  widest-swing target becomes visible, even if the player has moved away. Those targets are sight targets, not bot
  destinations. The game still handles aiming, reaction time, firing and movement through its own simulation.
- The default five-bot roster now shuffles the five authored bots; it does not select candidates by angular spread.
  Lower swinger counts choose a shuffled subset.
- Authored Blitz bots pass through each other so overlapping hold positions can swing independently. They still
  collide with the player and the map.
- Spawn data retains the exact captured coordinates. Runtime hull settling uses a bounded correction for voxel
  rounding, including corners that need both a small lift and a sideways adjustment. Two tight passages use
  one-inch collision rebuilt from native physics; the rest of the map retains its 20 cm grid. Browser collision
  and bot AI are approximations of native CS2.

## Map presentation

Ancient's geometry and textures come from the installed Valve map. The presentation now restores native baked
irradiance and sun shadows, sun direction/colour, authored surface UV transforms, correct lighting UV channels,
foliage colour handling and black unlit backing surfaces. Anisotropic filtering improves oblique texture clarity.

The layered world surfaces use UV2 for their lightmap; props use UV1. Foliage vertex colours contain animation
weights and must not darken the texture. The retained import is rebuilt with `tools/import-map.mjs --resume`;
`tools/map-lighting.mjs` reads the environment light and `tools/encode-map-lightmap.py` packs the HDR irradiance.
The staged GLB is about 171 MB plus 35 MiB of lighting atlases, with the existing 9.2-million-triangle geometry.
Collision detail is stored in `src/range/duel/maps/de_ancient.json`. Each fine region replaces only the corresponding
coarse volume, preserving solid materials and the distinction between bullet-blocking surfaces and player clips.
The refinement seeds open air from the original grid, without clearing space based on player or bot coordinates.
The map importer applies `tools/de_ancient-collision-regions.json` when rebuilding collision. A same-resolution
`--resume` keeps the existing collision data; to refine an older import separately, use the retained physics export:

```sh
node tools/refine-map-collision.mjs <export>/physics/maps/de_ancient/world_physics_physics.glb \
  src/range/duel/maps/de_ancient.json tools/de_ancient-collision-regions.json
```

Full Source 2 layered moss/dirt/wetness blending, local reflection probes and the native sky shader remain
approximate. This is a presentation improvement, not a complete Source 2 renderer. A strong GPU is still helpful.

## Existing controls

The Blitz tab retains difficulty/Smart mode, loadout presets, no primary, reaction/repeek reaction, aim offset,
headshots only, first-swing delay/gap, round time, random/sequential arena order, start arena, repeat and autoskip.
Captured per-bot jump/jiggle/duck permissions are retained as metadata (20/159/129 bots respectively), but those
optional behaviors are not reproduced by the current Blitz AI. These are local training controls; importing the
authored set does not claim identical Refrag AI or timing.
Arena completion and saved session history still use the duel engine.

## Validation

Importer tests check the complete captured roster, coordinate transforms, all three movement directions and
rejection of incomplete captures. Simulation tests cover spawn/facing, schedules, directional swings, stopping at
the sight target when the player moves, arena outcomes and loadouts. Collision tests check the complete roster's
full player hulls, tight passages and preservation of materials and bullet behavior across refinement boundaries.
Presentation tests cover both lighting UV channels, shared-material handling and resource disposal; visual review
compares the native A Site camera.

Verified locally on 2026-10-11 UTC: 109 focused tests and TypeScript passed. A sweep of all 38 arenas checked all
38 player hulls and 190 bot hulls, then confirmed that every bot started moving during the first 1.25 seconds with
an accelerated 0.1-second swing schedule. The browser check loaded all 38 named choices, started A Site with five
rendered bots and pointer lock, selected B Site #13, and reported no page or HTTP errors. The rendered Ancient had
279 lightmapped material groups. Full rounds retain the local simulation's AI and timing behavior described above.

# Blitz: Ancient

Added 2026-10-11 at the user's request, after Refrag's Blitz (their wiki calls it a user-generated version of
Crossfire: "fast-peeking, aggressive bots swinging you in quick succession"). Refrag's own bot sets are made in their
Creator Studio and live on their servers; nothing public lists their positions, so the arenas here are derived
from the map's geometry instead (below). It runs on the duel engine (`mode: 'blitz'`, variant `blitz` of
`DuelStage`), on Valve's de_ancient imported from the installed game.

## Map import

- `node tools/import-map.mjs ~/Desktop/cs2/cs2-game/game/csgo/maps/de_ancient.vpk --game ~/Desktop/cs2/cs2-game --keep --voxel .2 --headroom 16 --below 8`
  (under the memory cap; the Source 2 Viewer export of a full competitive map takes about 25 minutes and 2 GB of work
  files; `--resume <work folder>` reruns only the collision and presentation steps). The importer learned three things
  for competitive maps: the collision grid's vertical range is now `--headroom` above the highest spawn and `--below`
  under the lowest (4 and 1.5 by default, as before; Ancient's upper areas were cut off and the air flood could not
  cross them, which left 5,794 standing spots instead of 15,443); a floor under a player clip counts as standable
  (competitive maps smooth stairs, rocks and ledges with clip brushes players walk on); and a texture whose original
  cannot be extracted keeps the adapted image instead of failing the import.
- Collision: 20 cm voxels (150,321 boxes, 46,000 of them clips; 10 cm gave 572,712), `src/range/duel/maps/de_ancient.json`
  (8.7 MB; its 47,279 standing spots are the importer's lattice and include clip tops, see below). Render: `public/revamp/maps/de_ancient.glb` (174 MB, 9.2 M triangles, 200 textures at 1024², gitignored
  and mirrored by the deploy). Both are untouched Valve content.

## Arenas

`node tools/build-blitz-arenas.mjs de_ancient [--arenas 24] [--seed 7]` writes `src/range/duel/maps/de_ancient.blitz.json`:

- Walkability is computed on the voxel grid rebuilt from the collision boxes, not from the importer's standing spots
  (a 0.6 m lattice that misses narrow stairways, and which now also lists the tops of clip volumes such as Ancient's
  ceiling clip). A cell is standable when its floor voxel is solid (clips included) and a hull is air above it: the
  full 1.0 x 1.8 m hull above knee height, only the centre column below it, so the hull may overlap the next riser of
  a stair as CS2's step-up does. Cells are flooded from the spawn cells through their eight neighbours up to the step
  height (0.4 m) up or down; Ancient yields about 79,000 cells. The walkable cells are then sampled on a 0.6 m lattice.
- Every third walkable spot whose full hull fits (the engine's `fitsTerrain`, so nobody is nudged after placement)
  is a candidate. A swinger for it is a pair of such spots: a *peek* spot 5-30 m away that the candidate's eye can
  see, and the nearest *hold* spot 0.5-1.5 m from the peek (no more than 0.45 m up or down) hidden from that eye and
  from four eyes 0.3 m around it. Lines of sight are exact voxel walks through the shot-blocking boxes (clips let
  sight through).
- In play a swinger's navigator is its own: hold to peek, then straight at its goal. The duel engine's grid router
  only sees obstacles between 0 and 1.8 m, a flat-world assumption that does not hold on Ancient.
- A candidate needs peeks from at least four of twelve 30-degree sectors. Arenas are picked best score first
  (sectors × 10 + pairs, capped), at least 10 m apart. Each keeps up to ten swingers served sector by sector, closest to
  13 m first, never two within 2 m; you start facing the middle of their bearings.

## Play

- `BlitzConfig` (`src/range/duel/blitz.ts`, key `spraylab.blitz.v1`): swingers 1-5, difficulty easy/normal/hard (levels
  3/6/9) or a custom level, Smart mode (a level up after a clean clear, down after a death), bot loadout presets
  (pistol, save, eco, force, default, AWP: weapon pools and armor), no primary (you keep the sidearm, bots get pistols),
  reaction and repeek reaction in ms (0 = the level's own; the repeek value applies once a bot sees you again, through
  `BotTraits.repeekRecognitionMs`), aim offset (accuracy multiplier), headshots only, first-swing delay and swing gap,
  arena time limit, arena order (random / in order) and start arena, repeat (0, n or forever) and autoskip after three
  deaths in Smart mode. `blitzDuelConfig` turns that into the duel config: holders with the preset's loadout, no
  respawns, radar off, no spawn protection.
- `DuelSimulation` with a `blitz` argument places you at the arena (`freeSpawnPose`), picks `chooseSwingers` (as far
  apart in bearing as the set allows) and `swingSchedule`, and stands each swinger at its hold spot facing you with a
  `BotBrain` (holder). Until its swing time a swinger gets an idle command; at its swing it `hear`s your position and
  heads for it, sees you as it rounds the corner, and as a holder stops to shoot once it does. The arena ends like a
  duel round: all swingers down = won, you down = lost, the time limit = draw.
- `DuelEngine` keeps the run (`blitzRun`: arena index, clears and deaths there), steps Smart mode's level and picks
  the next arena (`nextArena`) when the round flow restarts, records each finished arena (`spraylab.blitz.history.v1`)
  and reports `status.blitz`. The stage shows ARENA n/N, swingers left, deaths here, and "Arena cleared in x s" /
  "You died".

## Limits

- Arenas are geometric, not Refrag's hand-made sets: a peek spot can be an odd angle, and a few arenas may sit in
  less common parts of the map. The generator is deterministic (seed 7) so arenas can be reviewed and pruned.
- Ancient renders without its baked lighting (the aim_redline lightmap path is map-specific) and the 9.2 M-triangle
  model is heavy: expect a few seconds of load and a strong GPU. No browser test drives the map; the unit tests cover
  the arena data, the swing timing and the round outcome.

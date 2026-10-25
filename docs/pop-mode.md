# Pop

Added 2026-10-09 at the user's request, after Refrag's Pop mode: bright balls float on a dark wall ahead
of you; a shot pops the first ball it crosses and a new one appears elsewhere. It is a range-engine drill
(`mode: 'pop'`, category Aim warm-up), so the weapon, recoil, spread, reload and crosshair code are the
ones every other range drill uses.

- Settings: `popSize` (ball diameter, 8-80 cm), `popCount` (balls at once, 1-12), `popSpacing` (minimum
  centre-to-centre space, 0.2-5 m), `popDistance` (from you to the wall, 3-40 m), `popColor` (hex;
  presets in `pop.ts`). Restore defaults covers them; the summary chip shows them.
- `src/range/pop.ts`: `PopField` owns the balls, the tally and the wall region (`popRegion`: centred at
  eye height, wide enough for the count at the requested spacing, capped at 55% of the half view width
  and 1.4 m half height). A new ball tries 64 random spots for one at least `spacing + diameter` from
  every other ball and otherwise takes the clearest. `hit()` is an analytic ray-sphere test that pops the
  nearest ball and spawns a replacement.
- `Simulation`: you stand at `POP_SPAWN` (z = 2, the near end of the range, so 40 m fit). `fire()`
  counts pop shots; `finish()` does not publish per-burst results in Pop; `publishPopResult()` (called
  by the engine's pause) records the running session once per new shots; New session resets it.
- `RangeEngine`: `popShot()` handles every ray (pellets included) with `PopField.hit`, draws tracers to
  the ball or the wall, marks misses on the wall, sets the POP / n POPS / MISS caption and plays
  `RangeAudio.playPop` (a synthesized sine bloop plus a band-passed click). `syncPop()` mirrors the balls
  as emissive spheres (`popMaterial`, colour from the setting), animates popped balls out over 180 ms and
  keeps a dark backdrop plane behind the balls; `setPopAtmosphere()` turns the sky black, pulls the fog in
  to `distance + 8` m and dims the lights, and restores the range look on leaving.
- HUD: POPS, HIT RATE, MISS and POPS / MIN replace the head/body cells. Tests: `pop.test.ts`,
  `tests/pop.spec.ts`.
- Ammo and hit sound (same day): `popAmmo` ('magazine' by default: the magazine is refilled after every
  shot and a held trigger keeps firing, as sv_infinite_ammo 1; 'reserve' refills the reserve and still
  reloads; 'off' is normal) is applied in `Simulation.fire()` and `burstSize` ignores the Burst length
  setting in Pop. `popSound` picks `RangeAudio.playHitmarker` (default; a synthesized Battlefield-style
  tick: 3.2 kHz, 4.85 kHz and 1.6 kHz sine partials decaying within 70 ms plus a 12 ms band-passed click)
  or `playPop`.
- Pop-only switches (same day): `popMuteGun` skips the shot's audio and fire foley in `popShot` (knife and the
  hit sound stay), `popHideImpacts` skips the miss marks (and clears existing ones when turned on),
  `popHideHud` adds `sl-hud-hidden` to the stage so the topline, target label, weapon slots, action
  tools, score and ammo bar, spread warning, rep feedback, ESC hint and FPS meter are hidden; the
  crosshair and hit flash remain.
- Hit sound file: `popSound` 'hitmarker' (default) plays `public/revamp/sounds/pop-hitmarker.mp3`, the file the
  user supplied (decoded at audio unlock; the synthesized tick stands in until then), 'synth' the synthesized
  tick, 'pop' the bloop. The master volume (top bar and Settings > Audio) is `settings.volume`, applied to
  every sound.
- Spray, peeking and looks (2026-10-10): `popHits` (1-10, default 1) is how many bullets a ball takes before it
  pops; `PopField.hit()` counts every bullet that crosses a ball as a hit (`hits`), pops the ball on its last one
  (`pops`), and a hit ball dims in three steps (`popDamagedMaterial`). HIT RATE and MISS count hits; POPS counts
  bursts; the hit caption says HIT for a hit that did not pop. A held spray always popped whatever each bullet
  crossed; what made spraying useless was the AK's recoil carrying the burst above the 2.8 m field within five
  rounds and the spread scattering the rest wider than a 30 cm ball, so one-hit balls vanished on the first round.
  `popWall` ('off', 'left', 'right') raises a peek wall (`popWall()`: 3 m wide, 2.8 m tall, 0.4 m thick, 1.5 m
  ahead, its edge 0.35 m past your shoulder on the chosen side, a yellow strip on that edge) that stops bullets
  (`wallHit`, `rayBoxDistance`) and movement (it joins `Simulation.environment.solids`); the ball field is centred
  1 m to the peek side, and changing the wall puts you back at `POP_SPAWN`. `popBackground` colours the backdrop
  plane, which is now unlit (`MeshBasicMaterial`) so the picked colour shows as picked; presets in `popBackgrounds`.
  The entrance benches live in `RangeEngine.benches`, outside the static batches, and are hidden in Pop.
- Ball respawn delay (2026-10-10): `popRespawn` (0-5 s, step 0.1, default 0) is how long a popped ball's
  replacement waits. `PopField` queues each due time in `pending`; `advance(time)`, called from every
  `Simulation.step()`, spawns the replacements whose time has come, and `hit()` takes the shot's `at` time
  (the engine passes `shot.at`). 0 spawns at once as before; `reset()` drops the queue.
- Moving balls (2026-10-10): per axis `popMoveX`/`popMoveY` (speed, m/s), `popRangeX`/`popRangeY` (how far a ball
  travels each way from where it appeared, m; clipped to the field) and `popFlipX`/`popFlipY` (sudden reversals per
  second, each due about 1/flips seconds after the last, jittered by half). `PopField.spawn()` gives a moving ball a
  random direction and a travel window; `advance(time)` (every simulation step) moves it, turns it back at the window's
  ends, reverses it when a flip is due and parts balls that overlap, bouncing them along the axis they met on. A still
  axis (speed or range 0) draws no extra random numbers, so seeded layouts are unchanged. Shots test the positions of
  the current tick; the renderer reads them every frame.
- Two-sided cover (same day): `popWall: 'both'` is a 1.6 m wide pillar (`POP_WALL.pillar`) centred on you, 1.5 m
  ahead, with an edge strip on each side; `PopWall.edges` lists every edge you can step past (`side` 0) and the ball
  field stays centred. Single-sided walls keep their 3 m width and one edge.
- Respawn pad (same day): `popRespawnMode` 'pad' queues each popped ball with an Infinity due time; `advance(time,
  player)` (the simulation passes its position) spawns every waiting ball the moment the player steps onto the pad
  (originally a 0.45 m disc around `POP_SPAWN`, now the rectangle below), edge-triggered so standing on it does nothing
  and a session never starts by triggering it. The engine drew it as a flat ring (`pop-pad`) that turned yellow while
  balls were waiting; see the pad entry below for the current rectangle.
- Wall width and the pad (same day): `popWallWidth` (0.6-8 m, default 3) is the wall's x extent: a one-sided wall keeps
  its edge 0.35 m past the shoulder of `POP_SPAWN` and runs that wide the other way; the pillar is that wide and centred
  on `POP_SPAWN` (its 1.6 m fixed width is gone). `popPad()` and `popSpawn()` put the pad and your start position at the
  wall's centre x (`POP_SPAWN.x` with no wall), so you begin behind cover and step out past the edge; changing the wall
  or its width re-places you there. The ball field still hangs off the edge (peek line), not the spawn.
- Pad size, colour and trigger sound (2026-10-11): the pad is a rectangle, `popPadWidth` across (x) and `popPadDepth`
  along your line to the wall (z), 0.3-3 m each (default 0.9 x 0.9, which covers the old 0.45 m disc); `PopPad` carries
  `halfW`/`halfD` and `onPadAt()` is an axis-aligned test with the edges included, so corners count. `popPadColor` is a
  hex colour (presets in `popPadColors`); the engine draws a filled `PlaneGeometry` in it (`pop-pad`, unlit, no fog)
  with a solid border strip (`pop-pad-edge`, a `ShapeGeometry` frame), at 30%/70% opacity idle and 85%/100% while balls
  wait. `PopField.drainPadTrigger()` returns how many balls the last step-on brought back; the engine's `syncPop` reads
  it each frame, flashes the pad to full opacity over 0.4 s and plays `RangeAudio.playPadSound(popPadSound, volume)`:
  'chime' (synthesized two-note rising triangle chime, E6 then B6, about 220 ms), 'hitmarker' or 'pop' (the hit
  sounds), or 'off'. Width/depth rebuild the field (reset keys); colour and sound are presentation-only.
- Chance a ball moves (same day): `popMoveChance` (0-1 in steps of 0.05, default 0.5, shown as a percentage) is rolled
  once per ball in `spawn()` whenever motion is configured; a ball that fails the roll stays still with no travel
  window. Still fields (no motion configured) still draw no extra random numbers.
- Wallbang (2026-10-18): with a peek wall up, `popWallbang` (off by default) lets bullets through it. `popWallMaterial`
  ('wood' by default, 'concrete', 'metal') is what the wall is made of and `popWallXray` (on by default) shows the balls it
  hides. `PopField.wallPass(origin, direction, range, stats)` sends the bullet through the wall with `resolveBulletRay`, the
  penetration arithmetic the drills and AI Duel use: the weapon's penetration, the material and the thickness of wall the
  ray actually crosses (the wall is 0.4 m, so a ray that clips an edge crosses far less than one that goes straight through)
  decide the damage left on the far side. It returns where the bullet entered and left the wall and `reach`, how far past the
  wall it can still do 1 damage (the range falloff after the exit); `hit(..., pass)` takes it, so a bullet that came out the
  far side hits the balls behind the wall (`PopHit.wallbang`) and one that did not stops at the wall's face, as before. At
  0.4 m wood lets every gun through; concrete and metal stop everything but the AWP, SSG 08, SCAR-20, G3SG1, Deagle and R8
  (pinned in `pop.test.ts`). Only bullets and pellets wallbang: a knife or Zeus never does, and the wall still blocks walking.
  `RangeEngine.popShot()` reads the pass: the caption says WALLBANG POP / WALLBANG HIT for a ball reached through the wall and
  BLOCKED for a shot the wall swallowed (MISS otherwise), a bullet that got through marks the wall where it entered (unless
  Hide bullet impacts is on). The wall's look (colour and texture) never changes with the material or the switch: the
  material only decides the penetration. With See balls through the wall, each ball carries a faint child mesh
  (`popGhostMaterial`, `GreaterDepth`) that draws only where the wall hides the ball. `popWallbang` and `popWallMaterial`
  re-create the field like the other wall settings; `popWallXray` is presentation.
- Presets (2026-10-20): a named setup of the balls and the environment that loads in one click, at the top of the Pop settings
  (`src/range/pop-presets.ts`, UI in `ui/screens/PopPresets.tsx`). A preset holds `popPresetKeys`: the 17 core keys (`popCoreKeys`:
  ball size, count, spacing, distance, hits, respawn and its mode, movement per axis and its chance, the peek wall, its width and
  the wallbang switch) plus the wall material, pad size, see-through balls and the three colours. The personal options
  (`popPersonalKeys`: ammo mode, hit sound, mute gun, hide impacts, hide HUD, pad sound) are never part of one, and a test makes
  every `pop*` setting belong to one list or the other. The nine built-in presets (`popBuiltInPresets`) set exactly the core keys
  (plus the wall material in the two wallbang ones), so loading one replaces the scenario but leaves your colours, pad size and
  see-through setting as they are. Saved presets (`PopPresetStore`, key `spraylab.pop.presets.v1`, at most 50, names up to 40
  characters, replaced when saved again under the same name ignoring case) keep every preset key, colours included. The store
  re-reads storage before each change, so two tabs do not overwrite each other (a `storage` event refreshes the list), bounds
  every value like the settings screen on the way in, and keeps working in memory when storage is unavailable.
- Weapon ties (same day): a preset can be tied to a weapon. Four built-ins are (Long range flicks on the AWP, Spray control on the AK-47, Pistol
  heads on the Deagle, Wallbang through concrete on the AWP), and "Tie to my current weapon" records `loadoutWeapon(settings)` for your own. Loading it
  equips that weapon the way the Loadout screen does: a pistol becomes the sidearm with no primary carried, anything else the
  primary. The list shows "Custom" when no preset matches the settings, says when a loaded one has been changed, Update replaces a
  saved preset (and renames it when the name field changed), Delete removes it. The Play screen and Settings > Game both show
  the block, so the chosen preset is kept in the store (`selectedId`, not persisted) and both show the same one. Presets are not a drill-wide default: Restore
  drill defaults still resets every Pop setting, and presets never touch the ammo, sound or HUD options.


## Initial specific modes (2026-10-25; corrected below)

The **Pop mode** selector offers Classic Pop plus three screenshot-inspired exercises. The user delegated the
rules; these are original interpretations, not claims of exact parity with the reference map.

- **Precision:** one 8 cm sphere at 8 m on a tall, narrow panel. Every pop relocates it within the panel.
- **Wide Flicks:** one 30 cm sphere at 6 m. Replacements alternate left/right, between 35% and 100% of the
  usable half width, with random height. The field spans roughly 77 degrees horizontally at the start position.
- **Microshot:** one 18 cm square at 8 m in a compact landscape panel. A hit anywhere inside the outline,
  including its centre and corners, counts; ray/plane bounds match the rendered square.

Selecting a mode resets the core drill settings to its recommended setup and recentres the player. Target size,
distance, hits to pop and respawn delay remain adjustable. Colours, weapon, ammo, sound and HUD are preserved.
Only Classic exposes multiple targets, movement, spacing, peek walls and pad respawning. The three specific
modes enforce one stationary target, no cover and timer respawns, even if imported settings contain old Classic
values. Panel bounds include target radius; replacements avoid the previous target, including after a delay.
Regular recoil, spread, scoring, hit sounds and endless session handling remain shared with Pop.

`popVariant` is stored with settings and saved presets and is an additional core preset key. Old settings and
presets default to Classic; loading an old or built-in preset exits the specific mode. Restore drill defaults
also returns to Classic. Rendering uses a subtle framed panel and a square outline for Microshot; miss impacts
land on the panel. No external assets are required.

Coverage: `pop-variants.test.ts`, existing Pop/preset regression tests, and `tests/pop-modes.spec.ts`.


## Center Return correction (2026-10-25)

The user clarified the first reference: put the crosshair on the fixed center dot, micro-adjust to a moving
dot entering from a side, then recenter and repeat. The first mode now shows as **Center Return**, retaining
`popVariant: 'precision'` so existing saved setups load the corrected drill. Wide Flicks and Microshot are unchanged.

- A permanent gold diamond marks the panel center. Aim at it continuously for 120 ms (no shot required) to arm a rep.
  It turns green while centering and dims while the side target is active. The HUD also names the current step.
- One target enters fully inside a randomly chosen left/right edge, at a random height, and crosses horizontally.
  The lane stays clear of the center, so camping or firing at the center cannot pop the crossing target.
- Pop the moving dot with the configured hits. The field then waits for a fresh center fixation. If it escapes
  through the far edge, the same center gate is required. A miss shot leaves the current target moving.
- `popPrecisionSpeed` sets crossing speed (0.1–3 m/s, default 0.8); it is sanitized, saved in presets and restored by
  defaults. The existing respawn delay adds a minimum pause after each completed/escaped rep, in addition to recentering.
- No target spawns while the menu is open. The simulation checks the displayed crosshair direction, including
  follow-recoil or scoped camera aim, rather than a shot ray with random spread. The marker never counts as a hit.
- Panel dimensions at 8 m are 1.5 × 2.2 m, with radius-aware bounds for extreme sizes. Motion uses simulation time,
  pauses with the session, and resets to the center step on a new session or settings rebuild.

Coverage: `pop-center-return.test.ts` exercises the gate, motion, repeat cycle, escape, multi-hit, cooldown, reset,
settings and recoil-aware aim. The browser smoke performs two actual moving-target hits separated by recentering,
checks marker persistence and phase prompts, and confirms that leaving the mode removes its marker.


## Microshot correction (2026-10-25)

The user clarified the rectangle reference: several close dots inside one rectangle; clear every dot before
moving on to the next rectangle. This supersedes the initial single-square interpretation above.

- Microshot now starts with three 8 cm dots inside a 0.7 × 0.6 m green rectangle at 8 m.
  Each dot uses the normal sphere hit test; the rectangle is only a boundary and awards no hits.
- Dots can be cleared in any order. A partial group never refills or moves, even after the respawn delay.
  Once the last dot is popped, a fresh group appears elsewhere inside the larger panel.
- **Dots per rectangle** supports 1–12 dots. Width and height support 0.3–2 m. Layout uses separated, jittered
  cells and grows the rectangle only as needed for large dots/counts, keeping it within the outer panel.
- **Next rectangle delay** begins at the final pop. Even at zero delay, the new group waits until the next
  simulation update, preventing pellets in the clearing shot from hitting the following group.
- Hits to pop applies to each dot. The HUD shows dots remaining and rectangles cleared; the existing Pop
  tally counts popped dots. Session reset cancels pending groups and restores a full, fresh group.
- Count/width/height are sanitized, saved in Pop presets and restored by drill defaults. Missing fields in
  older Microshot setups get the new defaults. Classic Pop's separate ball count remains independent.

Validation: 164 affected unit tests and TypeScript passed. Three Chromium tests passed, including six scored
shots clearing two groups, unchanged positions after partial clears, delayed group respawn, rendered frame
relocation, count changes, cleanup on leaving Microshot, and existing Center Return/preset regressions.
The temporary browser test server disables file watching because the host's inotify watcher limit was full.
Screenshots of both groups were captured and the first group visually reviewed.


## Micro Flicks correction (2026-10-25)

The user clarified the remaining single-dot reference: each successful click moves the dot a small distance
in a random direction, without allowing it to drift too far from center. The former Wide Flicks mode is now
**Micro Flicks**, retaining `popVariant: wide` so saved setups load the corrected mechanics.

- Start with one 8cm dot at the fixed center, 8m away. It stays still until popped (one hit by default).
- Every pop produces a 0.3m hop in a random direction from the previous dot. Its center always stays within
  a 1m radius of the original center, independent of where the player aims. The existing optional respawn
  delay preserves the previous position until the next dot appears. A fresh session starts at center.
- **Jump distance** supports 0.05–1m, capped by **Center radius** (0.3–1.2m). At the boundary, directions are
  resampled to stay inside the circle; an inward fallback handles pathological random sources while keeping
  the hop length. It never clamps a dot onto the edge or jumps across the whole field.
- Render only the dot against the existing backdrop; there is no small panel or second center target.
  Dot size, hits, distance, personal options, ordinary recoil/spread and Pop scoring remain available.
- New controls are sanitized, included in presets and Restore drill defaults, and missing fields in old
  saved wide-mode settings get the new defaults. Classic, Center Return and Microshot mechanics are unchanged.

Validation:169 affected units and TypeScript passed. Four Chromium tests passed, including ten scored shots
with measured hop lengths and center bounds, stationary waits, controls rebuilding the field at center,
saved preset/reload persistence, and the existing other-mode regressions. First/tenth-hop screenshots captured;
the tenth-hop image was visually reviewed. Unit coverage includes 1,000 successive hops in all directions,
constant outward RNG, extreme size/distance/radius, misses, multiple required hits, delayed replacement and reset.

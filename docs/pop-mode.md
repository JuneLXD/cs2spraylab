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

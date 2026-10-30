import {expect, test} from '@playwright/test';
import {selectDrill} from './menu-helpers';

test('Direction Calibration: a real-input flick, a fitted profile, the results panel and the Raw Accel export', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop WebGL smoke test');
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Sensitivity 3 keeps a 12-degree flick within the viewport for synthetic mouse moves.
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({
      mode: 'pop', popVariant: 'vector', popSize: 10, popDistance: 5, popVectorReach: 12, sensitivity: 3, sidearm: 'usp', primaryEnabled: false,
      quality: 'performance', spread: false, follow: false, autoFullscreen: false, protectShortcuts: false, volume: 0,
    }));
  });
  await page.goto('/'); await selectDrill(page, 'pop');
  await expect(page.getByLabel('Pop mode', {exact: true})).toHaveValue('vector');
  await expect(page.getByText('Largest flick', {exact: true})).toBeVisible();
  // The results live in the Aim tab; Pop's setup shows the count and the way there.
  await expect(page.getByText('0 calibration flicks recorded', {exact: false})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Open the Aim tab'})).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/range/engine.ts'))!.name;
    const {RangeEngine} = await import(/* @vite-ignore */ url), tick = RangeEngine.prototype.tick;
    RangeEngine.prototype.tick = function(time: number) {(window as any).vectorEngine = this; tick.call(this, time);};
  });
  await page.waitForFunction(() => !!(window as any).vectorEngine?.pop.getObjectByName('pop-center'));
  // Software rendering makes every scripted step slow, so give targets longer than the 4 s a player gets.
  await page.evaluate(() => {(window as any).vectorEngine.sim.pop.vector.timeout = 60;});
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  // A first target can already be up after the short rest; the field restarts below either way.
  await expect(page.getByTestId('pop-vector-cue')).toContainText('0 flicks recorded');
  // Bring the pointer from the button to the middle, then rest the view back on center and start the field afresh: that move
  // is not a flick.
  const origin = {x: 640, y: 360};
  await page.mouse.move(origin.x, origin.y);
  await page.evaluate(() => {const sim = (window as any).vectorEngine.sim; sim.resetRecovery(); sim.yaw = sim.pitch = 0; sim.pop.reset();});

  // One flick through real pointer events: rest on center until the target shows, then move the mouse to it.
  await page.waitForFunction(() => (window as any).vectorEngine.sim.pop.balls.length === 1, undefined, {timeout: 30000});
  await expect(page.getByTestId('pop-vector-cue')).toContainText('Flick to the target');
  const need = await page.evaluate(() => {
    const sim = (window as any).vectorEngine.sim, ball = sim.pop.balls[0], count = .022 * sim.settings.sensitivity * Math.PI / 180;
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    return {x: -(Math.atan2(-dx, -dz) - sim.yaw) / count, y: -(Math.asin(dy / Math.hypot(dx, dy, dz)) - sim.pitch) / count, yaw: sim.yaw, pitch: sim.pitch, id: ball.id};
  });
  await page.waitForTimeout(150);
  for (const fraction of [.08, .22, .42, .62, .76, .84, .86]) {
    await page.mouse.move(origin.x + need.x * fraction, origin.y + need.y * fraction); await page.waitForTimeout(16);
  }
  await page.waitForTimeout(90);
  for (const fraction of [.93, 1]) {await page.mouse.move(origin.x + need.x * fraction, origin.y + need.y * fraction); await page.waitForTimeout(16);}
  // The pointer events turned the view toward the target.
  const moved = await page.evaluate(() => ({yaw: (window as any).vectorEngine.sim.yaw, pitch: (window as any).vectorEngine.sim.pitch}));
  expect(Math.hypot(moved.yaw - need.yaw, moved.pitch - need.pitch)).toBeGreaterThan(.01);
  await page.screenshot({path: info.outputPath('vector-flick.png')});
  const trial = await page.evaluate(() => {
    const sim = (window as any).vectorEngine.sim, t = sim.pop.vector.trial;
    return {spawn: t?.spawn, now: sim.time, accumulator: sim.accumulator, events: t?.events.length,
      first: t?.events[0]?.t, last: t?.events.at(-1)?.t, x: t?.events.reduce((s: number, e: any) => s + e.bx, 0), y: t?.events.reduce((s: number, e: any) => s + e.by, 0),
      gaps: t?.events.slice(1).map((e: any, i: number) => +(e.t - t.events[i].t).toFixed(4))};
  });
  info.annotations.push({type: 'trial', description: JSON.stringify(trial)});
  // Snap the last bit onto the same target and shoot it.
  expect(await page.evaluate(id => {
    const sim = (window as any).vectorEngine.sim, ball = sim.pop.balls[0];
    if (ball?.id !== id) return false;
    const dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    sim.yaw = Math.atan2(-dx, -dz); sim.pitch = Math.asin(dy / Math.hypot(dx, dy, dz)); sim.pressTrigger(); sim.release('mouse');
    return true;
  }, need.id)).toBe(true);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.direction.v1') ?? '[]'));
  await expect.poll(async () => (await stored()).length, {timeout: 20000, message: JSON.stringify({errors})}).toBe(1);
  const [first] = await stored();
  // Software rendering draws only a few frames a second here, so these pointer events arrive hundreds of milliseconds apart and
  // no real flick timing survives (the unit tests cover the analysis at real event rates). What this checks: real pointer events
  // reach the recording, in mouse space and degrees, adding up to the movement the target needed (up to whole counts).
  expect(first, JSON.stringify({first, trial})).toMatchObject({condition: 'off', shots: 1});
  expect(trial.events).toBeGreaterThanOrEqual(3);
  expect(Math.abs(trial.x - first.tx)).toBeLessThan(.1); expect(Math.abs(trial.y - first.ty)).toBeLessThan(.1);

  // Sixty more from a simulated player who falls 10% short going up and overshoots left by 6%.
  const made = await page.evaluate(() => {
    const sim = (window as any).vectorEngine.sim, count = .022 * sim.settings.sensitivity * Math.PI / 180;
    const angles = (p: {x: number; y: number; z: number}) => {
      const dx = p.x - sim.position.x, dy = p.y - sim.position.y, dz = p.z - sim.position.z;
      return {yaw: Math.atan2(-dx, -dz), pitch: Math.asin(dy / Math.hypot(dx, dy, dz))};
    };
    const jerk = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u);
    let made = 0;
    for (let guard = 0; made < 60 && guard < 100000; guard++) {
      if (!sim.pop.balls.length) {const c = angles(sim.pop.center); sim.yaw = c.yaw; sim.pitch = c.pitch; sim.advance(.004); continue;}
      const goal = angles(sim.pop.balls[0]), dyaw = goal.yaw - sim.yaw, dpitch = goal.pitch - sim.pitch;
      const yawGain = dyaw > 0 ? 1.06 : 1, pitchGain = dpitch > 0 ? .9 : 1;
      let previous = 0;
      for (let t = .004; t < .62; t += .004) {
        const f = t < .2 ? 0 : t < .38 ? .9 * jerk((t - .2) / .18) : t < .44 ? .9 : .9 + .1 * jerk(Math.min(1, (t - .44) / .12)), step = f - previous;
        previous = f;
        const primary = t < .44 ? step : 0, correction = step - primary;
        sim.aim(-(dyaw * (primary * yawGain + correction)) / count, -(dpitch * (primary * pitchGain + correction)) / count); sim.advance(.004);
      }
      const hit = angles(sim.pop.balls[0]); sim.yaw = hit.yaw; sim.pitch = hit.pitch; sim.pressTrigger(); sim.release('mouse'); sim.advance(.01);
      made++;
    }
    return made;
  });
  expect(made).toBe(60);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('spraylab.direction.v1') ?? '[]').length === 61);
  await expect(page.getByTestId('pop-vector-cue')).toContainText('flicks recorded');
  await page.keyboard.press('Escape');
  await expect(page.getByText(/6\d calibration flicks recorded/)).toBeVisible();
  await page.getByRole('button', {name: 'Open the Aim tab'}).click();
  await expect(page.getByRole('heading', {name: 'Direction profile'})).toBeVisible();
  await expect(page.getByText(/6\d calibration flicks recorded/)).toBeVisible();
  await expect(page.locator('svg.sl-direction-chart')).toBeVisible();
  await expect(page.getByTestId('direction-gap')).toContainText('cross-validated');
  await page.getByRole('button', {name: 'Use fitted profile'}).click();
  await expect(page.getByRole('switch', {name: 'Apply profile in SprayLab'})).toBeChecked();
  await expect(page.getByTestId('raw-accel-fields')).toContainText('L/R output DPI ratio (left sens multiplier)');
  const applied = await page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!).directionProfile);
  // Falling short going up asks for more upward gain; overshooting left asks for less leftward gain.
  expect(applied.up).toBeGreaterThan(1.03); expect(applied.left).toBeLessThan(applied.right);
  // The panel sits below the session's report in the Aim tab: bring each part into view for the review screenshots.
  await page.getByRole('heading', {name: 'Direction profile'}).evaluate(element => element.scrollIntoView({block: 'start'}));
  await page.screenshot({path: info.outputPath('vector-panel-chart.png')});
  await page.getByRole('heading', {name: 'Use it in CS2'}).evaluate(element => element.scrollIntoView({block: 'center'}));
  await page.screenshot({path: info.outputPath('vector-panel-export.png')});

  await page.reload(); await selectDrill(page, 'pop');
  await expect(page.getByText(/6\d calibration flicks recorded/)).toBeVisible();
  await page.getByRole('button', {name: 'Open the Aim tab'}).click();
  await expect(page.getByRole('switch', {name: 'Apply profile in SprayLab'})).toBeChecked();
  expect(errors).toEqual([]);
});

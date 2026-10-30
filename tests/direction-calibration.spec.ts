import {expect, test, type Page} from '@playwright/test';
import {selectDrill} from './menu-helpers';

/** Exposes the running engine of `file` as window.aimEngine. */
async function exposeEngine(page: Page, file: '/range/engine.ts' | '/duel/DuelEngine.ts', className: 'RangeEngine' | 'DuelEngine') {
  await page.evaluate(async ({file, className}) => {
    const url = performance.getEntriesByType('resource').find(entry => entry.name.includes(file))!.name;
    const Engine = (await import(/* @vite-ignore */ url))[className], tick = Engine.prototype.tick;
    Engine.prototype.tick = function(time: number) {(window as any).aimEngine = this; return tick.call(this, time);};
  }, {file, className});
}
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.direction.v1') ?? '[]'));
const settings = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('spraylab.range.v2')!));

/** Calibration flicks in classic Pop through the engine's own simulation, synchronously in the page (software rendering here draws a
 * few frames a second, too slow for real pointer timing; the unit tests cover the analysis at real event rates): pop the ball under
 * the crosshair, place its replacement in the next of 16 directions 6 to 10 degrees away, wait for recoil to settle, then a mouse
 * flick (minimum jerk, counts every 4 ms) that falls 10% short going up and overshoots left by 6%, a correction and the shot. */
function flick(page: Page, count: number) {
  return page.evaluate(count => {
    const sim = (window as any).aimEngine.sim, unit = .022 * sim.settings.sensitivity * Math.PI / 180;
    const angles = (p: {x: number; y: number; z: number}) => {
      const dx = p.x - sim.position.x, dy = p.y - sim.position.y, dz = p.z - sim.position.z;
      return {yaw: Math.atan2(-dx, -dz), pitch: Math.asin(dy / Math.hypot(dx, dy, dz))};
    };
    const step = (seconds: number) => {for (let t = 0; t < seconds - 1e-9; t += .004) sim.advance(.004);};
    const jerk = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u);
    let made = 0;
    for (let i = 0; i < count; i++) {
      step(.25);
      const before = sim.pop.balls[0], here = angles(before);
      sim.yaw = here.yaw; sim.pitch = here.pitch; sim.pressTrigger(); sim.release('mouse');
      const ball = sim.pop.balls[0];
      if (ball.id === before.id) continue;
      const a = i * Math.PI / 8, amp = (6 + (i % 3) * 2) * Math.PI / 180, yaw = sim.yaw - Math.cos(a) * amp, pitch = sim.pitch + Math.sin(a) * amp;
      const toward = {x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch)}, along = (ball.z - sim.position.z) / toward.z;
      ball.x = sim.position.x + toward.x * along; ball.y = sim.position.y + toward.y * along;
      step(1);
      const goal = angles(ball), dyaw = goal.yaw - sim.yaw, dpitch = goal.pitch - sim.pitch, yawGain = dyaw > 0 ? 1.06 : 1, pitchGain = dpitch > 0 ? .9 : 1;
      let previous = 0;
      for (let t = .004; t < .62; t += .004) {
        const f = t < .2 ? 0 : t < .38 ? .9 * jerk((t - .2) / .18) : t < .44 ? .9 : .9 + .1 * jerk(Math.min(1, (t - .44) / .12)), d = f - previous;
        previous = f;
        const primary = t < .44 ? d : 0, correction = d - primary;
        sim.aim(-(dyaw * (primary * yawGain + correction)) / unit, -(dpitch * (primary * pitchGain + correction)) / unit); sim.advance(.004);
      }
      step(.1);
      const hit = angles(ball); sim.yaw = hit.yaw; sim.pitch = hit.pitch; sim.pressTrigger(); sim.release('mouse'); sim.advance(.01);
      made++;
    }
    return made;
  }, count);
}

test('Direction calibration: flicks from Pop, the fitted profile in the Aim tab\'s own view, and the recording switch', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop WebGL smoke test');
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // A profile saved in the old Pop exercise: it opens as Classic Pop with Classic's balls.
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({
      mode: 'pop', popVariant: 'vector', popSize: 10, popCount: 1, popDistance: 5, sensitivity: 3, sidearm: 'usp', primaryEnabled: false,
      quality: 'performance', spread: false, follow: false, autoFullscreen: false, protectShortcuts: false, volume: 0,
    }));
  });
  await page.goto('/'); await selectDrill(page, 'pop');
  const popMode = page.getByLabel('Pop mode', {exact: true});
  await expect(popMode).toHaveValue('classic');
  expect(await popMode.locator('option').allTextContents()).not.toContain('Direction Calibration');
  await expect(page.getByText('Largest flick', {exact: true})).toHaveCount(0);
  expect(await settings(page)).toMatchObject({popVariant: 'classic', popSize: 30, popDistance: 12, directionCalibrate: true});
  await page.getByLabel('Balls at once', {exact: true}).fill('1');
  await expect.poll(async () => (await settings(page)).popCount).toBe(1);

  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeEnabled({timeout: 60000});
  await exposeEngine(page, '/range/engine.ts', 'RangeEngine');
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  await page.waitForFunction(() => !!(window as any).aimEngine?.sim?.pop?.balls.length);
  // Headless pointer lock is unreliable on this host ("Mouse capture blocked"); the simulation runs either way.
  await page.evaluate(() => {(window as any).aimEngine.sim.active = true;});
  expect(await page.evaluate(() => (window as any).aimEngine.sim.aimLog.calibration)).toEqual({flip: 0});
  // A real pointer movement reaches the recorder with what Direction Calibration needs (no profile, filed as 'off'): under pointer
  // lock, or by dragging when the lock was refused.
  const locked = await page.waitForFunction(() => !!document.pointerLockElement, undefined, {timeout: 5000}).then(() => true, () => false);
  await page.mouse.move(640, 400);
  if (!locked) await page.mouse.down();
  await page.mouse.move(700, 430); await page.mouse.move(760, 460);
  if (!locked) await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).aimEngine.sim.aimLog.events.some((event: {c: number}) => event.c === 0))).toBe(true);
  expect(await flick(page, 50)).toBeGreaterThanOrEqual(48);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Enter range', exact: true})).toBeVisible();
  // Saved on the pause, with the session's report.
  await expect.poll(async () => (await stored(page)).length).toBeGreaterThanOrEqual(48);
  const records = await stored(page);
  expect(records.every((record: {condition: string; valid: boolean}) => record.condition === 'off' && record.valid)).toBe(true);
  expect(new Set(records.map((record: {dir: number}) => record.dir)).size).toBe(16);

  await page.getByRole('button', {name: 'Aim', exact: true}).click();
  const tab = page.getByRole('region', {name: 'Aim report'});
  await expect(tab.getByRole('tab', {name: 'Session report'})).toHaveAttribute('aria-selected', 'true');
  await expect(tab.getByRole('heading', {name: 'Pop', exact: true})).toBeVisible();
  await expect(tab.getByText(/\d+ flicks from this session went into Direction calibration/)).toBeVisible();
  await tab.getByRole('button', {name: 'Open Direction calibration'}).click();
  await expect(tab.getByRole('tab', {name: 'Direction calibration'})).toHaveAttribute('aria-selected', 'true');
  await expect(tab.getByRole('heading', {name: 'Your aim by direction'})).toBeVisible();
  await expect(tab.getByText(/\d+ calibration flicks from every mode · profile fitted/)).toBeVisible();
  const record = tab.getByRole('switch', {name: 'Record calibration flicks'});
  await expect(record).toBeChecked();
  await expect(tab.locator('svg.sl-direction-chart')).toBeVisible();
  await expect(tab.getByTestId('direction-gap')).toContainText('cross-validated');
  await page.screenshot({path: info.outputPath('direction-view.png')});
  await tab.getByRole('button', {name: 'Use fitted profile'}).click();
  await expect(tab.getByRole('switch', {name: 'Apply profile in SprayLab'})).toBeChecked();
  await expect(tab.getByTestId('raw-accel-fields')).toContainText('L/R output DPI ratio (left sens multiplier)');
  const applied = (await settings(page)).directionProfile;
  // Falling short going up asks for more upward gain; overshooting left asks for less leftward gain.
  expect(applied.up).toBeGreaterThan(1.03); expect(applied.left).toBeLessThan(applied.right);
  await tab.getByRole('heading', {name: 'Use it in CS2'}).evaluate(element => element.scrollIntoView({block: 'center'}));
  await page.screenshot({path: info.outputPath('direction-view-profile.png')});

  // Recording off: another session's flicks are not kept, and the profile stays.
  await record.click();
  await expect(record).not.toBeChecked();
  await expect(tab.getByText('Off: nothing new is recorded. Your flicks and profile stay.')).toBeVisible();
  await expect.poll(async () => (await settings(page)).directionCalibrate).toBe(false);
  await expect(tab.getByRole('switch', {name: 'Blind A/B test'})).toBeDisabled();
  const before = (await stored(page)).length;
  await page.getByRole('button', {name: 'Play', exact: true}).click();
  await page.getByRole('button', {name: /^(Enter|Resume) range$/}).click();
  // The engine has the new settings: recording off.
  await page.waitForFunction(() => {const engine = (window as any).aimEngine; return engine?.sim?.pop?.balls.length && engine.sim.aimLog.calibration === undefined;});
  await page.evaluate(() => {(window as any).aimEngine.sim.active = true;});
  expect(await flick(page, 4)).toBeGreaterThanOrEqual(3);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: /^(Enter|Resume) range$/})).toBeVisible();
  expect((await stored(page)).length).toBe(before);
  // The Aim tab opens on the view you left.
  await page.getByRole('button', {name: 'Aim', exact: true}).click();
  await expect(tab.getByRole('tab', {name: 'Direction calibration'})).toHaveAttribute('aria-selected', 'true');
  await expect(tab.getByRole('switch', {name: 'Record calibration flicks'})).not.toBeChecked();
  await expect(tab.getByRole('switch', {name: 'Apply profile in SprayLab'})).toBeChecked();
  expect(errors).toEqual([]);
});

test('Direction calibration: Aim Botz feeds the same recorder from the duel engine', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium', 'Desktop Aim Botz smoke test');
  test.setTimeout(240000);
  await page.addInitScript(() => {
    if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', weapon: 'ak47', quality: 'auto', autoFullscreen: false}));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await selectDrill(page, 'botz');
  await page.getByLabel('Number of bots').press('Home');
  await page.getByLabel('Protect Ctrl+W').uncheck();
  await exposeEngine(page, '/duel/DuelEngine.ts', 'DuelEngine');
  await page.waitForFunction(() => !!(window as any).aimEngine?.sim?.botz);
  expect(await page.evaluate(() => (window as any).aimEngine.aimLog.calibration)).toEqual({flip: 0});
  await page.getByRole('button', {name: 'Start Aim Botz'}).click();
  // Headless pointer lock is unreliable on this host: try Resume again when the capture was blocked.
  for (let attempt = 0; attempt < 3 && !await page.getByRole('button', {name: 'Pause Aim Botz'}).isVisible({timeout: 8000}).catch(() => false); attempt++)
    await page.getByRole('button', {name: 'Resume Aim Botz'}).click().catch(() => undefined);
  await expect(page.getByRole('button', {name: 'Pause Aim Botz'})).toBeVisible();
  // Mouse movement under pointer lock reaches the recorder with Direction Calibration's data, filed without a profile.
  for (const [x, y] of [[700, 450], [740, 470], [780, 480]]) await page.mouse.move(x, y);
  await expect.poll(() => page.evaluate(() => (window as any).aimEngine.aimLog.events.some((event: {c: number; bx: number}) => event.c === 0 && event.bx !== 0)),
    {timeout: 20000}).toBe(true);
  // Recoil is reported settled with nothing fired.
  expect(await page.evaluate(() => (window as any).aimEngine.sim.aimPlayer((window as any).aimEngine.sim.actors[0]).settled)).toBe(true);
  expect(errors).toEqual([]);
});

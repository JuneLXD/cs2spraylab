import {expect, test} from '@playwright/test';

for (const mode of ['guided', 'duel', 'botz'] as const) {
  test(`${mode}: corner HUD keeps live values and controls clear of the aiming area`, async ({page}) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, weapon: 'awp', quality: 'performance', resolution: '1280x720', showFps: false, volume: 0, protectShortcuts: false}));
      localStorage.setItem('spraylab.duel.v1', JSON.stringify({shortcutProtection: false, botCount: 1}));
      localStorage.setItem('spraylab.botz.v1', JSON.stringify({shortcutProtection: false, botCount: 3}));
    }, mode);
    await page.setViewportSize({width: 1600, height: 900});
    await page.goto('/');
    const enter = page.getByRole('button', {name: mode === 'guided' ? 'Enter range' : mode === 'duel' ? 'Enter duel' : 'Start Aim Botz', exact: true});
    await expect(enter).toBeEnabled({timeout: 90000});
    await page.locator('.range-stage').evaluate(element => element.requestFullscreen());
    await enter.click();
    const pause = page.getByRole('button', {name: mode === 'guided' ? 'Pause range' : mode === 'duel' ? 'Pause duel' : 'Pause Aim Botz', exact: true});
    await expect(pause).toBeVisible();
    const view = page.locator('.sl-game-view');
    const stage = (await view.boundingBox())!;
    const score = (await page.locator('.sl-score-bar').boundingBox())!;
    const ammo = (await page.locator('.sl-ammo').boundingBox())!;
    const stats = (await page.locator('.sl-bottom-stats').boundingBox())!;
    expect(score.y + score.height).toBeLessThan(stage.y + stage.height * .25);
    expect(stats.y).toBeGreaterThan(stage.y + stage.height * .75);
    expect(ammo.x).toBeGreaterThan(stage.x + stage.width * .65);
    expect(await page.locator('.sl-hud').evaluate(element => getComputedStyle(element).zIndex)).toBe('6');
    await page.screenshot({path: `test-results/ui-${mode}-1600.png`});
    // Scope stays below all four HUD corners, and Inspect/Scope keep their own clickable bounds.
    await page.mouse.click(stage.x + stage.width * .5, stage.y + stage.height * .5, {button: 'right'});
    await expect(page.locator('.weapon-scope')).toBeVisible();
    await page.screenshot({path: `test-results/ui-${mode}-scope.png`});
    await page.keyboard.press('Escape');
    await expect(pause).toBeHidden();
    await expect(page.getByRole('button', {name: 'Reload', exact: true})).toBeHidden();
    for (const size of [{width: 1280, height: 720}, {width: 390, height: 844}, {width: 844, height: 390}]) {
      await page.setViewportSize(size);
      const actions = page.locator('.weapon-action-tools');
      const bounds = (await actions.boundingBox())!;
      expect(bounds.width).toBeGreaterThan(30);
      expect(await actions.evaluate(element => {
        const b = element.querySelector('button')!.getBoundingClientRect();
        return !!document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.weapon-action-tools');
      })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path: `test-results/ui-${mode}-${size.width}.png`});
    }
    expect(errors).toEqual([]);
  });
}

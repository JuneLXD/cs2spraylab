import {expect, test} from '@playwright/test';
for (const mode of ['guided', 'botz'] as const) {
  test(`${mode}: Play starts, pauses and resumes the mounted scene in fullscreen`, async ({page}) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      localStorage.setItem('spraylab.range.v2', JSON.stringify({mode, weapon:'ak47', quality:'performance', volume:0, protectShortcuts:false}));
      localStorage.setItem('spraylab.botz.v1', JSON.stringify({shortcutProtection:false, botCount:3}));
      localStorage.setItem('spraylab.setup-hint.v1', 'seen');
    }, mode);
    await page.setViewportSize({width:1600, height:900});
    await page.goto('/');
    await expect(page.getByLabel('Training mode')).toHaveValue(mode);
    const start = page.getByRole('button', {name:mode === 'guided' ? 'Enter range' : 'Start Aim Botz', exact:true});
    await expect(start).toBeEnabled({timeout:90000});
    await page.screenshot({path:`test-results/ui-play-${mode}-1600.png`});
    const canvas = page.locator(mode === 'guided' ? '.canvas-host canvas' : 'canvas[data-duel]');
    await canvas.evaluate(element => element.setAttribute('data-scene-check','persistent'));
    await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await expect(page.getByLabel('Play setup')).toBeVisible();
    await start.click();
    const pause = page.getByRole('button',{name:mode === 'guided' ? 'Pause range' : 'Pause Aim Botz',exact:true});
    await expect(pause).toBeVisible();
    await expect(page.getByLabel('Play setup')).toBeHidden();
    await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Play setup')).toBeVisible();
    await expect(page.getByRole('button',{name:'New session',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await expect(canvas).toHaveAttribute('data-scene-check','persistent');
    for (const size of [{width:1280,height:720},{width:390,height:844},{width:844,height:390}]) {
      await page.setViewportSize(size);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('button',{name:mode === 'guided' ? 'Enter range' : 'Resume Aim Botz',exact:true})).toBeInViewport();
      await page.screenshot({path:`test-results/ui-play-${mode}-${size.width}.png`});
    }
    await page.getByRole('button',{name:mode === 'guided' ? 'Enter range' : 'Resume Aim Botz',exact:true}).click();
    await expect(pause).toBeVisible();
    await expect(canvas).toHaveAttribute('data-scene-check','persistent');
    expect(errors).toEqual([]);
  });
}

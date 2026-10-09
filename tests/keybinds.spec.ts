import {expect, test, type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';

// Written for the first visit before aim_redline and the AWP became the defaults: AI Duel with the AK-47 at Auto quality.
test.beforeEach(async ({page}) => page.addInitScript(() => {
  if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', weapon: 'ak47', quality: 'auto'}));
}));

const autoexec = `// TFGH movement with a sniper toggle
bind "t" "+forward"; bind "g" "+back"; bind "f" "+left"; bind "h" "+right"
bind "j" "+sprint"; bind "ALT" "+duck"; bind "k" +jump;
unbind "w"; unbind "1"
alias +knife slot3; alias -knife slot1;
bind "i" "+knife"
bind "F12" "+left;volume 0"
`;
const convars = '"config"\n{\n\t"convars"\n\t{\n\t\t"sensitivity"\t\t"1.5"\n\t\t"option_duck_method"\t\t"true"\n\t}\n}\n';

async function openKeyboardTab(page: Page) {
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('tab', {name: 'Keyboard / Mouse', exact: true}).click();
}
async function importConfig(page: Page) {
  await page.getByLabel('Import CS2 config files').setInputFiles([
    {name: 'autoexec.cfg', mimeType: 'text/plain', buffer: Buffer.from(autoexec)},
    {name: 'cs2_user_convars_0_slot0.vcfg', mimeType: 'text/plain', buffer: Buffer.from(convars)},
  ]);
}

test('Keyboard / Mouse mirrors CS2, imports autoexec.cfg and rebinds keys', async ({page}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop keyboard workflow');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await openKeyboardTab(page);
  for (const title of ['Keyboard & Mouse Settings', 'Movement Keys', 'Weapon Keys', 'UI Keys', 'Communication Options', 'Chat Wheel Keys'])
    await expect(page.getByRole('heading', {name: title, exact: true})).toBeVisible();
  await expect(page.getByRole('group', {name: 'Move Forward', exact: true})).toContainText('W');

  await importConfig(page);
  const report = page.locator('.kb-report');
  await expect(report).toContainText('Imported cs2_user_convars_0_slot0.vcfg, autoexec.cfg');
  await expect(report).toContainText('F12: Browsers open developer tools on F12.');
  await expect(page.getByRole('group', {name: 'Move Forward', exact: true})).toContainText('T');
  await expect(page.getByRole('group', {name: 'Move Forward', exact: true})).not.toContainText('W');
  await expect(page.getByRole('group', {name: 'Melee Weapons', exact: true})).toContainText('script');
  await expect(page.getByLabel('Duck Mode', {exact: true})).toHaveValue('1');
  await page.getByRole('tab', {name: 'Game', exact: true}).click();
  await expect(page.getByLabel('Sensitivity', {exact: true})).toHaveValue('1.5');
  await page.getByRole('tab', {name: 'Keyboard / Mouse', exact: true}).click();

  await page.getByRole('button', {name: 'Add a key for Jump', exact: true}).click();
  await expect(page.locator('.kb-capture')).toContainText('Jump');
  await page.keyboard.press('Escape');
  await expect(page.locator('.kb-capture')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', {name: 'Add a key for Jump', exact: true}).click();
  await expect(page.locator('.kb-capture')).toBeVisible();
  await page.keyboard.press('KeyV');
  await expect(page.locator('.kb-change')).toContainText('V now runs Jump');
  await expect(page.getByRole('group', {name: 'Jump', exact: true})).toContainText('V');

  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export .cfg', exact: true}).click();
  const cfg = await readFile(await (await download).path(), 'utf8');
  expect(cfg).toContain('bind "t" "+forward"');
  expect(cfg).toContain('bind "v" "+jump"');
  expect(cfg).toContain('unbind "w"');
  expect(cfg).toContain('sensitivity "1.5"');

  await page.reload();
  await openKeyboardTab(page);
  await expect(page.getByRole('group', {name: 'Jump', exact: true})).toContainText('V');
  await expect(page.locator('.kb-source')).toContainText('autoexec.cfg');
  await page.getByRole('button', {name: 'Reset', exact: true}).click();
  await page.getByRole('button', {name: 'SprayLab defaults', exact: true}).click();
  await expect(page.getByRole('group', {name: 'Move Forward', exact: true})).toContainText('W');
  expect(errors).toEqual([]);
});

test('AI Duel fires and switches weapons through imported binds', async ({page}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop keyboard workflow');
  await page.goto('/');
  await openKeyboardTab(page);
  await page.getByLabel('Import CS2 config files').setInputFiles([{name: 'autoexec.cfg', mimeType: 'text/plain',
    buffer: Buffer.from('unbind "MOUSE1"\nbind "k" "+attack"\nbind "6" "slot3"\n')}]);
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await page.getByLabel('Protect Ctrl+W').uncheck();
  await page.getByRole('button', {name: 'Enter duel'}).click();
  await expect(page.getByRole('button', {name: 'Pause duel'})).toBeVisible();
  const ammo = async () => Number((await page.locator('.duel-ammo strong').innerText()).split('/')[0].trim());
  await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await ammo()).toBe(30);
  await page.keyboard.down('KeyK'); await page.waitForTimeout(150); await page.keyboard.up('KeyK');
  await expect.poll(ammo, {timeout: 5000}).toBeLessThan(30);
  await page.keyboard.press('Digit6');
  await expect(page.getByRole('button', {name: 'Equip Default knife', exact: true})).toHaveAttribute('aria-pressed', 'true');
});

test('imported binds drive range movement instead of WASD', async ({page}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop keyboard workflow');
  await page.addInitScript(() => Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', {value: undefined}));
  await page.goto('/');
  await page.getByLabel('Training mode').selectOption('guided');
  await openKeyboardTab(page);
  await importConfig(page);
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await page.getByRole('button', {name: 'Enter range', exact: true}).click();
  const distance = async () => parseFloat(await page.locator('.distance-input output').innerText());
  const start = await distance();
  await page.keyboard.down('KeyW'); await page.waitForTimeout(400); await page.keyboard.up('KeyW');
  expect(await distance()).toBe(start);
  await page.keyboard.down('KeyT');
  await expect.poll(distance).toBeLessThan(start - 1);
  await page.keyboard.up('KeyT');
  // `bind i +knife` with `alias +knife slot3; alias -knife slot1`: hold for the knife, release for the rifle.
  await page.keyboard.down('KeyI');
  await expect(page.getByRole('button', {name: 'Equip Default knife', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('KeyI');
  await expect(page.getByRole('button', {name: 'Equip AK-47', exact: true})).toHaveAttribute('aria-pressed', 'true');
});

import {describe, expect, it} from 'vitest';
import {gameData} from './config';
import {NativeReloadState} from './weapon-actions';
import {reloadClip} from './reload-clock';

describe('build 2000930 AUG reload lock', () => {
  it.each([false, true])('unlocks at the authored 3.2 seconds (empty=%s)', empty => {
    const reload = new NativeReloadState('aug');
    reload.ammo = empty ? 0 : 5;
    expect(reload.start(1)).toBe(true);
    expect(reload.until).toBe(4.2);
    expect(reloadClip('aug', empty)!.insert).toBe(1.4);
    reload.advance(2.399);
    expect(reload.ammo).toBe(empty ? 0 : 5);
    reload.advance(2.4);
    expect(reload.ammo).toBe(30);
    reload.advance(4.199);
    expect(reload.ammo).toBe(30);
    expect(reload.active).toBe(true);
    reload.advance(4.2);
    expect(reload.active).toBe(false);
    expect(gameData.weapons.aug.alternate.reload).toBe(3.2);
  });
});

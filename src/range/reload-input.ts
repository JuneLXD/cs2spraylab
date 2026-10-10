import type {Equipment} from './equipment';

// Current server class/caller proof covers these ordinary magazine weapons.
// Other weapon families retain their existing admission behavior.
const verifiedWeapons = new Set<Equipment>(['ak47', 'm4a4', 'm4a1s', 'awp', 'glock', 'usp', 'deagle']);
export const usesNativeReloadInput = (id: Equipment) => verifiedWeapons.has(id);

/** Explicit R is below both attack branches in the native item dispatcher.
 * This is weapon readiness, not the player's separate equip/deploy gate. */
export function reloadInputAllows(time: number, nextPrimary: number, primaryDown: boolean,
  secondaryDown: boolean, nextSecondary: number, pendingBurst: boolean) {
  return time + 1e-9 >= nextPrimary && !primaryDown && !pendingBurst &&
    !(secondaryDown && time + 1e-9 >= nextSecondary);
}

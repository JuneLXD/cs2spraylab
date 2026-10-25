import {defaults, type Mode, type Settings} from '../config';
import {popVariants} from '../pop';
import type {BotzConfig} from '../duel/botz';
import type {DuelConfig} from '../duel/config';
import {blitzSummary, type BlitzConfig} from '../duel/blitz';

/** Restore practice controls without changing input, video, cosmetics or the chosen drill. */
export function rangeDrillDefaults(mode: Mode): Partial<Settings> {
  const {burst, peekScenario, peekDuration, drillPace, follow, transferRule, transferAfter,
    impactSize, tracers, moving, targetSpeed, showImpactPattern, showMousePath, animatedGuides,
    popVariant, popPrecisionSpeed, popFlickStep, popFlickRadius, popClusterCount, popClusterWidth, popClusterHeight, popSize, popCount, popSpacing, popDistance, popColor, popAmmo, popSound, popMuteGun, popHideImpacts, popHideHud,
    popBackground, popHits, popWall, popWallWidth, popWallbang, popWallMaterial, popWallXray, popRespawn, popRespawnMode, popMoveX, popRangeX, popFlipX, popMoveY, popRangeY, popFlipY, popMoveChance,
    popPadWidth, popPadDepth, popPadColor, popPadSound} = defaults;
  return {burst, peekScenario, peekDuration, drillPace, follow, transferRule, transferAfter,
    impactSize, tracers, moving, targetSpeed, showImpactPattern, showMousePath, animatedGuides, spread: mode !== 'guided',
    popVariant, popPrecisionSpeed, popFlickStep, popFlickRadius, popClusterCount, popClusterWidth, popClusterHeight, popSize, popCount, popSpacing, popDistance, popColor, popAmmo, popSound, popMuteGun, popHideImpacts, popHideHud,
    popBackground, popHits, popWall, popWallWidth, popWallbang, popWallMaterial, popWallXray, popRespawn, popRespawnMode, popMoveX, popRangeX, popFlipX, popMoveY, popRangeY, popFlipY, popMoveChance,
    popPadWidth, popPadDepth, popPadColor, popPadSound};
}
export function drillSetupSummary(settings: Settings, botz: BotzConfig, duel: DuelConfig, blitz?: BlitzConfig): string {
  if (settings.mode === 'blitz' && blitz) return blitzSummary(blitz);
  if (['botz', 'reflex', 'redline'].includes(settings.mode)) {
    const movement = botz.movement === 'close' ? 'strafe and close in' : botz.movement === 'strafe' ? 'strafe A-D' : botz.map === 'island' ? 'run straight' : 'stand still';
    return `${botz.botCount} ${botz.botCount === 1 ? 'bot' : 'bots'} · ${movement} · ${botz.sessionSeconds ? `${botz.sessionSeconds}s` : 'endless'} · ${botz.infiniteAmmo === 'magazine' ? 'never reload' : botz.infiniteAmmo === 'reserve' ? 'infinite reserve' : 'normal ammo'}`;
  }
  if (settings.mode === 'duel') return `${duel.botCount} ${duel.botCount === 1 ? 'opponent' : 'opponents'} · skill ${duel.skill} · ${duel.roundSeconds}s rounds`;
  if (settings.mode === 'deathmatch') return `${duel.botCount} ${duel.botCount === 1 ? 'opponent' : 'opponents'} · skill ${duel.skill} · ${duel.respawnSeconds}s respawns · ${duel.infiniteAmmo === 'magazine' ? 'never reload · ' : duel.infiniteAmmo === 'reserve' ? 'infinite reserve · ' : ''}aim_redline`;
  if (settings.mode === 'pop' && settings.popVariant === 'microshot') return `Microshot · ${settings.popClusterCount} ${settings.popClusterCount === 1 ? 'dot' : 'dots'} per rectangle · ${settings.popSize} cm · ${settings.popDistance} m away · clear all to advance${settings.popHits > 1 ? ` · ${settings.popHits} hits per dot` : ''}${settings.popRespawn > 0 ? ` · ${settings.popRespawn} s between rectangles` : ''}`;
  if (settings.mode === 'pop' && settings.popVariant !== 'classic') return `${popVariants.find(variant => variant.id === settings.popVariant)?.name} · 1 target · ${settings.popSize} cm · ${settings.popDistance} m away${settings.popVariant === 'precision' ? ` · center → moving dot · ${settings.popPrecisionSpeed} m/s` : ` · ${settings.popFlickStep} m jumps · ${settings.popFlickRadius} m center radius`} · ${settings.popHits} ${settings.popHits === 1 ? 'hit' : 'hits'} to pop${settings.popRespawn > 0 ? ` · ${settings.popRespawn} s respawn` : ''}${settings.popAmmo === 'magazine' ? ' · never reload' : settings.popAmmo === 'reserve' ? ' · infinite reserve' : ''}`;
  if (settings.mode === 'pop') return `${settings.popCount} ${settings.popCount === 1 ? 'ball' : 'balls'} · ${settings.popSize} cm · ${settings.popSpacing} m apart · ${settings.popDistance} m away${settings.popHits > 1 ? ` · ${settings.popHits} hits to pop` : ''}${settings.popWall !== 'off' ? ` · peek wall, ${settings.popWall}, ${settings.popWallWidth} m${settings.popWallbang ? `, wallbang (${settings.popWallMaterial})` : ''}` : ''}${settings.popRespawnMode === 'pad' ? ` · respawn on the ${settings.popPadWidth} x ${settings.popPadDepth} m pad` : settings.popRespawn > 0 ? ` · ${settings.popRespawn} s respawn` : ''}${settings.popMoveX > 0 && settings.popRangeX > 0 ? ` · ${settings.popMoveX} m/s ±${settings.popRangeX} m left-right` : ''}${settings.popMoveY > 0 && settings.popRangeY > 0 ? ` · ${settings.popMoveY} m/s ±${settings.popRangeY} m up-down` : ''}${(settings.popMoveX > 0 && settings.popRangeX > 0 || settings.popMoveY > 0 && settings.popRangeY > 0) && settings.popMoveChance < 1 ? ` · ${Math.round(settings.popMoveChance * 100)}% of balls move` : ''}${settings.popAmmo === 'magazine' ? ' · never reload' : settings.popAmmo === 'reserve' ? ' · infinite reserve' : ''}`;
  if (settings.mode === 'hearing') return 'Locate footsteps and shots by direction and distance';
  return `${settings.burst ? `${settings.burst}-shot bursts` : 'full magazine'} · ${settings.spread ? 'spread on' : 'spread off'} · ${settings.moving ? 'moving target' : 'stationary target'}`;
}

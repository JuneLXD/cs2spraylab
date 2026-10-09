import {memo} from 'react';
import {gameData, isDuelEngineMode, loadoutWeapon, weaponNames, type Settings} from '../../config';
import {SliderRow as Slider, SwitchRow as Toggle} from '../primitives';
export const TrainingSettings = memo(function TrainingSettings({settings, update}: {settings: Settings; update: (patch: Partial<Settings>) => void}) {
  const weapon = gameData.weapons[loadoutWeapon(settings)];
  return <>              <h2>Training</h2><label className="select-row">Burst length<select aria-label="Burst length" value={settings.burst} onChange={e => update({ burst: +e.target.value })}><option value="0">Full magazine</option><option value="5">5 rounds</option><option value="10">10 rounds</option><option value="15">15 rounds</option></select></label>
              <label className="select-row">Peeking angles<select aria-label="Peeking angles" value={settings.peekScenario} onChange={e=>update({peekScenario:e.target.value as Settings['peekScenario']})}><option value="mixed">Mixed situations</option><option value="common">Common angles</option><option value="deep">Deep holds</option><option value="off-angle">Off-angles</option><option value="elevated">Elevated holds</option></select></label>
              <Slider label="Peeking target duration" value={settings.peekDuration} min={.5} max={10} step={.25} suffix=" s" onChange={peekDuration=>update({peekDuration})}/>
              <label className="select-row">Counterstrafe / burst pace<select aria-label="Drill pace" value={settings.drillPace} onChange={e=>update({drillPace:e.target.value as Settings['drillPace']})}><option value="practice">Practice / 8 s exposure</option><option value="challenge">Challenge / 1.5 s exposure</option></select></label>
              <Toggle label="Follow recoil" checked={settings.follow} onChange={v => update({ follow: v })} />
              <Toggle label="Practice spread" checked={isDuelEngineMode(settings.mode) || settings.spread} disabled={isDuelEngineMode(settings.mode)} onChange={v => update({ spread: v })} />
              <p className="setting-explanation">Spread adds the weapon's random shot dispersion and the extra inaccuracy from movement, jumping and repeated fire. Turning it off does not remove recoil. Switching drills applies the recommended setting: off for Guided spray, on for other drills. AI Duel, Aim Botz, Fast Aim / Reflex and aim_redline always apply it, as CS2 does.</p>
              <label className="select-row">Transfer to B<select aria-label="Transfer trigger" value={settings.transferRule} onChange={e => update({transferRule: e.target.value as Settings['transferRule']})}><option value="bullet">After a bullet count</option><option value="kill">After A loses 100 health</option></select></label>
              {settings.transferRule === 'bullet' && <Slider label="Transfer after bullet" value={settings.transferAfter} min={1} max={weapon.magazine - 1} onChange={transferAfter => update({transferAfter})}/>}
              <p className="setting-explanation">Transfer targets have 100 health and no armor. Recoil continues across A and B. A short selected burst caps the transfer count before its last round.</p>
              <Slider label="Bullet impact size" value={settings.impactSize} min={.5} max={4} step={.25} suffix="x" onChange={impactSize=>update({impactSize})}/>
              <label className="select-row">Bullet tracers<select aria-label="Bullet tracers" value={settings.tracers} onChange={e => update({tracers: e.target.value as Settings['tracers']})}><option value="every">Every shot (practice)</option><option value="native">CS2 effects & cadence</option><option value="off">Off</option></select></label>
              <p className="setting-explanation">Every shot draws a tracer from the muzzle to where each round lands, suppressed guns included. CS2 cadence matches the game: every third round for most rifles and none for suppressed weapons. AI Duel bots always use CS2 cadence.</p>
              <Toggle label="Moving target" checked={settings.moving} onChange={v => update({ moving: v })} />
              <label className="select-row">Target movement<select aria-label="Target movement" value={settings.targetSpeed} onChange={e => update({ targetSpeed: e.target.value as Settings['targetSpeed'] })}><option value="rifle">{weaponNames[settings.weapon]} / {weapon.speed} u/s</option><option value="smg">MP9 / 240 u/s</option><option value="knife">Knife / 250 u/s</option></select></label>
              <h2>Wall guides</h2>
              <Toggle label="Impact pattern (left)" checked={settings.showImpactPattern} onChange={v => update({ showImpactPattern: v })} />
              <Toggle label="Mouse movement (right)" checked={settings.showMousePath} onChange={v => update({ showMousePath: v })} />
              <Toggle label="Animated wall guides" checked={settings.animatedGuides} onChange={animatedGuides => update({animatedGuides})}/>
</>;
});

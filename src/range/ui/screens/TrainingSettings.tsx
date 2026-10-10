import {memo, useId} from 'react';
import {gameData, isDuelEngineMode, loadoutWeapon, weaponNames, type Settings} from '../../config';
import {popBackgrounds, popColors, popLimits} from '../../pop';
import {SettingRow, SliderRow as Slider, SwitchRow as Toggle} from '../primitives';
export const TrainingSettings = memo(function TrainingSettings({settings, update}: {settings: Settings; update: (patch: Partial<Settings>) => void}) {
  const weapon = gameData.weapons[loadoutWeapon(settings)];
  const colorId = useId(), backgroundId = useId();
  if (settings.mode === 'pop') return <>
    <h2>Pop</h2>
    <Slider label="Ball size" value={settings.popSize} min={popLimits.size[0]} max={popLimits.size[1]} suffix=" cm" onChange={popSize => update({popSize})}/>
    <Slider label="Balls at once" value={settings.popCount} min={popLimits.count[0]} max={popLimits.count[1]} onChange={popCount => update({popCount})}/>
    <Slider label="Hits to pop" value={settings.popHits} min={popLimits.hits[0]} max={popLimits.hits[1]} onChange={popHits => update({popHits})}/>
    <Slider label="Space between balls" value={settings.popSpacing} min={popLimits.spacing[0]} max={popLimits.spacing[1]} step={.1} suffix=" m" onChange={popSpacing => update({popSpacing})}/>
    <Slider label="Distance to the balls" value={settings.popDistance} min={popLimits.distance[0]} max={popLimits.distance[1]} step={.5} suffix=" m" onChange={popDistance => update({popDistance})}/>
    <label className="select-row">Peek wall<select aria-label="Peek wall" value={settings.popWall} onChange={e => update({popWall: e.target.value as Settings['popWall']})}><option value="off">Off</option><option value="left">Peek out to the left</option><option value="right">Peek out to the right</option></select></label>
    <SettingRow label="Ball color" htmlFor={colorId} className="sl-color-row"><div className="sl-color-control">
      <input id={colorId} aria-label="Ball color" type="color" value={settings.popColor} onChange={event => update({popColor: event.target.value})}/>
      <div className="sl-swatches" role="group" aria-label="Ball color presets">{popColors.map(([name, value]) => <button key={value} type="button" aria-label={`${name} balls`} title={name} aria-pressed={settings.popColor === value} style={{background: value}} onClick={() => update({popColor: value})}/>)}</div>
    </div></SettingRow>
    <SettingRow label="Background color" htmlFor={backgroundId} className="sl-color-row"><div className="sl-color-control">
      <input id={backgroundId} aria-label="Background color" type="color" value={settings.popBackground} onChange={event => update({popBackground: event.target.value})}/>
      <div className="sl-swatches" role="group" aria-label="Background color presets">{popBackgrounds.map(([name, value]) => <button key={value} type="button" aria-label={`${name} background`} title={name} aria-pressed={settings.popBackground === value} style={{background: value}} onClick={() => update({popBackground: value})}/>)}</div>
    </div></SettingRow>
    <label className="select-row">Ammo<select aria-label="Ammo mode" value={settings.popAmmo} onChange={e => update({popAmmo: e.target.value as Settings['popAmmo']})}><option value="magazine">Never reload</option><option value="reserve">Infinite reserve</option><option value="off">Normal reserves</option></select></label>
    <label className="select-row">Hit sound<select aria-label="Hit sound" value={settings.popSound} onChange={e => update({popSound: e.target.value as Settings['popSound']})}><option value="hitmarker">Hitmarker (your file)</option><option value="synth">Synthesized hitmarker</option><option value="pop">Pop</option></select></label>
    <Toggle label="Mute gun sound" checked={settings.popMuteGun} onChange={popMuteGun => update({popMuteGun})}/>
    <Toggle label="Hide bullet impacts" checked={settings.popHideImpacts} onChange={popHideImpacts => update({popHideImpacts})}/>
    <Toggle label="Hide HUD" checked={settings.popHideHud} onChange={popHideHud => update({popHideHud})}/>
    <Toggle label="Practice spread" checked={settings.spread} onChange={spread => update({spread})}/>
    <label className="select-row">Bullet tracers<select aria-label="Bullet tracers" value={settings.tracers} onChange={e => update({tracers: e.target.value as Settings['tracers']})}><option value="every">Every shot (practice)</option><option value="native">CS2 effects & cadence</option><option value="off">Off</option></select></label>
    <p className="setting-explanation">Balls float on a dark wall ahead of you at the chosen distance. Each shot hits the first ball it crosses; a ball pops once it has taken the chosen hits (1 pops on the first bullet, more lets a spray stay on one ball, dimming it as it goes) and a new one appears elsewhere, at least the chosen space from the others. Recoil and spread apply as in CS2; misses mark the wall. The peek wall stands 1.5 m ahead of you with its edge just past your shoulder: step out to the chosen side to see the balls, which are centred on your peek line. It stops bullets and movement. Never reload keeps the magazine full (sv_infinite_ammo 1), Infinite reserve still reloads (sv_infinite_ammo 2). Hitmarker plays the sound file you provided; the synthesized hitmarker and the pop are made in the trainer. Mute gun sound keeps the hit sound; Hide HUD leaves the crosshair and the hit flash.</p>
  </>;
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

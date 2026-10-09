import {memo} from 'react';
import {GraduationCap} from 'lucide-react';
import {gameData, loadoutWeapon, modeNames, type Settings} from '../../config';
import {cosmeticLabel,cosmeticPreview} from '../../cosmetics';
import {equippedCosmetic,type ProgressionProfile} from '../../progression';
import {cosmeticCatalog} from '../../cosmetics';
import {latestChanges} from '../../changelog-data';
import type {Equipment} from '../../equipment';
import {modeInfo} from '../../mode-info';
import {Button} from '../primitives';
import {RecentSessions} from '../RecentSessions';
import type {RecentSession} from '../session-data';
export const HomeScreen = memo(function HomeScreen({settings,profile,rows,ready,start,setup,loadout,armory,history,changelog,tutorial}:{settings:Settings;profile:ProgressionProfile;rows:RecentSession[];ready:boolean;start:()=>void;setup:()=>void;loadout:()=>void;armory:()=>void;history:()=>void;changelog:()=>void;tutorial:()=>void}) {
  const agent = equippedCosmetic(profile,cosmeticCatalog,'agent');
  const slots:Equipment[]=[...(settings.primaryEnabled?[settings.weapon]:[]),settings.sidearm,'knife','zeus'];
  return <section className="sl-home sl-menu-page" aria-label="Home"><div className="sl-home-left"><section className="sl-continue"><div className={`sl-continue-art sl-drill-${settings.mode}`}><img src={cosmeticPreview(profile,loadoutWeapon(settings))} alt=""/><small>LAST DRILL</small></div><div><small>{settings.mode==='redline'?'AIM BOTZ · MAP BY BOT REED':'CONTINUE PRACTICE'}</small><h1>{modeNames[settings.mode]}</h1><p>{modeInfo[settings.mode].benefit}</p><div className="sl-continue-actions"><Button primary disabled={!ready} onClick={start}>Go</Button><Button onClick={setup}>Setup</Button></div></div></section>
    <section className="sl-whats-new"><header><h2>What’s new</h2><button onClick={changelog}>Changelog</button></header>{latestChanges.sections.slice(-3).reverse().map(section=><button key={section.id} onClick={changelog}><strong>{section.title}</strong><p>{section.items[0]}</p></button>)}</section>
    <button className="sl-learn" onClick={tutorial}><GraduationCap size={24}/><span><strong>Learn the fundamentals</strong><small>Movement, counter-strafing and shot timing</small></span></button>
    <footer>Build {gameData.build} · Game-derived weapon data <a href="https://github.com/HamzahAlrawi/cs2spraylab" target="_blank" rel="noreferrer">Source</a></footer>
    </div><div className="sl-home-agent"><button className="sl-agent-label" onClick={armory}><b>{agent?.label??'SAS'}</b> Agent · change in the Armory</button><img className="sl-agent-render" src={agent?.imageUrl??'/models/target.png'} alt={agent?.label??'SAS'}/><small>EQUIPPED</small><div className="sl-home-equipped">{slots.map((id,index)=><button key={`${id}-${index}`} onClick={loadout}><img src={cosmeticPreview(profile,id)} alt=""/><span>{cosmeticLabel(profile,id)}</span></button>)}</div></div><RecentSessions rows={rows} open={history}/></section>;
});

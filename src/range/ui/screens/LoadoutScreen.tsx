import {memo, useEffect, useState} from 'react';
import {Check, Diamond, X} from 'lucide-react';
import {gameData, pistolIds, weaponNames, type Pistol, type Settings, type Weapon} from '../../config';
import {equipmentNames, type Equipment} from '../../equipment';
import {cosmeticLabel, cosmeticPreview} from '../../cosmetics';
import {cosmeticsForEquipment, equippedCosmetic, type ProgressionController, type ProgressionProfile} from '../../progression';
import {Button, IconButton, SwitchRow, Tabs, Tile} from '../primitives';

const groups = [
  {id:'rifles',label:'Rifles',weapons:['ak47','m4a4','m4a1s','galil','famas','sg553']},
  {id:'snipers',label:'Snipers',weapons:['awp','ssg08','g3sg1','scar20']},
  {id:'smgs',label:'SMGs',weapons:['mp9','mp7','mp5sd','mac10','ump45','p90','bizon']},
  {id:'heavy',label:'Heavy',weapons:['m249','negev','nova','xm1014','mag7','sawedoff']},
  {id:'pistols',label:'Pistols',weapons:pistolIds},
] as const;
type Group = typeof groups[number]['id'];
const groupFor = (id: Weapon): Group => groups.find(group => (group.weapons as readonly string[]).includes(id))?.id ?? 'rifles';
type LoadoutSlot = 'primary' | 'sidearm' | 'knife' | 'zeus' | 'gloves' | 'agent';
export const LoadoutScreen = memo(function LoadoutScreen({settings, update, profile, controller, armory, close}: {
  settings: Settings; update: (patch: Partial<Settings>) => void; profile: ProgressionProfile; controller: ProgressionController; armory: (equipment: string) => void; close: () => void;
}) {
  const [slot,setSlot] = useState<LoadoutSlot>(settings.primaryEnabled ? 'primary' : 'sidearm');
  const weapon = slot === 'sidearm' ? settings.sidearm : slot === 'primary' ? settings.weapon : slot;
  const [group,setGroup] = useState<Group>(groupFor(settings.primaryEnabled ? settings.weapon : settings.sidearm));
  const selected = equippedCosmetic(profile,controller.catalog,weapon);
  const finishes = cosmeticsForEquipment(controller.catalog,weapon);
  const name = (id: string) => id === 'gloves' || id === 'agent' ? equippedCosmetic(profile,controller.catalog,id)?.label ?? id : cosmeticLabel(profile,id as Equipment);
  const preview = (id: string) => equippedCosmetic(profile,controller.catalog,id)?.imageUrl ?? `/models/${id}.png`;
  const stats = slot === 'primary' || slot === 'sidearm' || slot === 'zeus' ? gameData.weapons[weapon as Weapon] : undefined;
  const chooseSlot = (next: LoadoutSlot) => {setSlot(next); if (next === 'primary' || next === 'sidearm') setGroup(groupFor(next === 'primary' ? settings.weapon : settings.sidearm));};
  const chooseWeapon = (id: Weapon) => {if ((pistolIds as readonly string[]).includes(id)) {setSlot('sidearm'); update({sidearm:id as Pistol});} else {setSlot('primary'); update({weapon:id,primaryEnabled:true});}};
  return <div className="sl-loadout-screen">
    <header className="sl-screen-title"><h1 id="panel-title">Loadout</h1><IconButton label="Close panel" onClick={close}><X size={22}/></IconButton></header>
    <div className="sl-loadout-body"><aside className="sl-loadout-slots" aria-label="Loadout slots"><SwitchRow label="Carry a primary weapon" checked={settings.primaryEnabled} onChange={primaryEnabled=>update({primaryEnabled})}/>
      {([['primary',settings.weapon,'Primary · 1'],['sidearm',settings.sidearm,'Sidearm · 2'],['knife','knife','Knife · 3'],['zeus','zeus','Taser · 4'],['gloves','gloves','Gloves'],['agent','agent','Agent']] as const).map(([id,equipment,label]) => <Tile key={id} selected={slot===id} onClick={()=>chooseSlot(id)} aria-label={`Select ${id} slot`}><img src={preview(equipment)} alt=""/><span><small>{label}{id==='primary'&&!settings.primaryEnabled?' · NOT CARRIED':''}</small><b>{name(equipment)}</b></span></Tile>)}
      <Button onClick={()=>armory(weapon)} aria-label="Open the armory: weapon finishes, knives, gloves and agents"><Diamond size={18}/>Open the Armory</Button>
    </aside><section className="sl-weapon-stage" aria-label="Weapon selection">
      {(slot==='primary'||slot==='sidearm') && <><Tabs label="Weapon types" value={group} items={groups} onChange={setGroup}/><div className="sl-weapon-tiles">{groups.find(item=>item.id===group)!.weapons.map(id=><Tile key={id} selected={weapon===id} onClick={()=>chooseWeapon(id)} aria-label={`Equip ${weaponNames[id]}`}><img src={cosmeticPreview(profile,id)} alt=""/><span>{weaponNames[id]}</span></Tile>)}</div></>}
      <div className={`sl-weapon-hero sl-hero-${slot}`}><img src={preview(weapon)} alt={name(weapon)}/></div>
      <div className="sl-weapon-details"><div><small>{slot.toUpperCase()}{slot==='primary' ? ` · ${groupFor(settings.weapon).toUpperCase()}` : ''}</small><h2>{name(weapon)}</h2></div>{stats && <dl>{[['Magazine',`${stats.magazine} / ${stats.reserve}`],['Fire rate',`${Math.round(60/stats.cycle)} RPM`],['Damage',String(stats.damage)],['Run speed',`${stats.speed} u/s`]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}</div>
    </section><section className="sl-finishes" aria-label={`${weapon in weaponNames ? weaponNames[weapon as Weapon] : weapon} skins`}><header><h2>{weapon in weaponNames ? weaponNames[weapon as Weapon] : weapon} finishes <span>{finishes.length}</span></h2><small>All unlocked</small></header><div className="sl-finish-grid">{finishes.map(item=><Tile key={item.id} selected={selected?.id===item.id} aria-label={`Equip ${weapon in weaponNames ? weaponNames[weapon as Weapon] : weapon} skin ${item.label}`} onClick={()=>controller.equip(weapon,item.id)}><img src={item.imageUrl} alt="" loading="lazy"/><span>{item.label}</span>{selected?.id===item.id && <small className="sl-equipped-tag"><Check size={11}/>Equipped</small>}</Tile>)}</div></section></div>
  </div>;
});

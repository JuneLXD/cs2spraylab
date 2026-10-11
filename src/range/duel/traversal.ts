import {UNIT,type ActorEnvironment} from '../actor-physics';
import type {ContactActor} from '../actor-contact';
import type {TerrainSolid} from '../terrain';
import type {Arena} from './geometry';
import {blocksMovement} from './environment';
import {actorHeight} from '../actor-contact';
import {moveOnTerrain} from '../actor-collision';
import type {Vec} from '../actor-physics';

/** The ground plane: the duel hall floors at y = 0; an imported map's collision has its own floors, so its plane sits
 * under the whole grid and only catches a fall through a gap. */
export const arenaFloor=(arena:Arena)=>arena.workshop?.floor??0;

const terrainCache=new WeakMap<Arena,{source:Arena['solids'];volumes:Arena['traversalVolumes'];solids:TerrainSolid[]}>();

export function arenaTerrain(arena:Arena):TerrainSolid[] {
  const cached=terrainCache.get(arena);
  if(cached?.source===arena.solids&&cached.volumes===arena.traversalVolumes)return cached.solids;
  const solids:TerrainSolid[]=arena.solids.filter(blocksMovement).map(solid=>({center:solid.center,size:solid.size,id:solid.id,
    traversal:solid.shape?{kind:'ramp',axis:solid.shape.axis,rise:solid.size.y,direction:solid.shape.highSide}:undefined}));
  for(const volume of arena.traversalVolumes??[]) solids.push({id:volume.id,center:volume.center,size:volume.size,
    traversal:volume.kind==='water'?{kind:'water',surfaceY:volume.water?.surfaceY}:{kind:'ladder',normal:{x:volume.ladder?.axis==='x'?(volume.ladder.facing??1):0,
      y:0,z:volume.ladder?.axis==='z'?(volume.ladder.facing??1):0}}});
  terrainCache.set(arena,{source:arena.solids,volumes:arena.traversalVolumes,solids});
  return solids;
}

// Imported maps have thousands of boxes, and every movement check walks all of them. One tick of movement only reaches
// the terrain around the actor (a hull is 0.41 m wide either side; even the 3500 u/s velocity cap moves 0.7 m a tick),
// so above this many boxes it gets just that: the same boxes, in the same order.
const LOCAL_TERRAIN=256,TERRAIN_CELL=1,TERRAIN_REACH=1.5;
const terrainIndex=new WeakMap<readonly TerrainSolid[],{minX:number;minZ:number;columns:number;rows:number;cells:number[][];
  windows:Map<string,readonly TerrainSolid[]>}>();
export function arenaTerrainNear(arena:Arena,near:Vec,reach=TERRAIN_REACH):readonly TerrainSolid[] {
  const solids=arenaTerrain(arena);
  if(solids.length<=LOCAL_TERRAIN)return solids;
  let index=terrainIndex.get(solids);
  const {minX,minZ}=index??arena;
  const column=(x:number,columns:number)=>Math.max(0,Math.min(columns-1,Math.floor((x-minX)/TERRAIN_CELL)));
  const row=(z:number,rows:number)=>Math.max(0,Math.min(rows-1,Math.floor((z-minZ)/TERRAIN_CELL)));
  if(!index) {
    const columns=Math.max(1,Math.ceil((arena.maxX-minX)/TERRAIN_CELL)),rows=Math.max(1,Math.ceil((arena.maxZ-minZ)/TERRAIN_CELL));
    const cells=Array.from({length:columns*rows},()=>[] as number[]);
    solids.forEach((solid,i)=>{
      for(let r=row(solid.center.z-solid.size.z/2,rows);r<=row(solid.center.z+solid.size.z/2,rows);r++)
        for(let c=column(solid.center.x-solid.size.x/2,columns);c<=column(solid.center.x+solid.size.x/2,columns);c++)cells[r*columns+c].push(i);
    });
    index={minX,minZ,columns,rows,cells,windows:new Map()};terrainIndex.set(solids,index);
  }
  const r0=row(near.z-reach,index.rows),r1=row(near.z+reach,index.rows),c0=column(near.x-reach,index.columns),c1=column(near.x+reach,index.columns);
  // Actors stay in the same few cells for many ticks.
  const key=`${r0}:${r1}:${c0}:${c1}`,cached=index.windows.get(key);
  if(cached)return cached;
  const found=new Set<number>();
  for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)for(const i of index.cells[r*index.columns+c])found.add(i);
  const local=[...found].sort((a,b)=>a-b).map(i=>solids[i]);
  if(index.windows.size>=4096)index.windows.clear();
  index.windows.set(key,local);
  return local;
}

/** `near`: where the actor is, so a large arena only hands over the terrain within reach of it. */
export function arenaMovementEnvironment(arena:Arena,actors:readonly ContactActor[],selfId:number,time:number,pitch:number,near?:Vec):ActorEnvironment {
  return {solids:near?arenaTerrainNear(arena,near):arenaTerrain(arena),bounds:arena,floor:arenaFloor(arena),actors,selfId,time,pitch,
    jumpRules:{bhopWindow:1/128,spamTime:1/64,autoBhop:false,enableBunnyhopping:false}};
}

export const actorBody=(actor:ContactActor)=>({center:{x:actor.position.x,y:actor.feet+actorHeight(actor)/2,z:actor.position.z},
  size:{x:32*UNIT,y:actorHeight(actor),z:32*UNIT}});

export function canWalkTo(from:Vec,to:Vec,arena:Arena) {
  const length=Math.hypot(to.x-from.x,to.z-from.z);
  if(length>12)return false;
  const world={solids:arenaTerrain(arena),floor:arenaFloor(arena),bounds:arena};
  let at={...from};const steps=Math.max(1,Math.ceil(length/.12));
  for(let step=1;step<=steps;step++) {
    const moved=moveOnTerrain(at,{x:from.x+(to.x-from.x)*step/steps,y:at.y,z:from.z+(to.z-from.z)*step/steps},72*UNIT,world,true);
    if(!moved.grounded)return false;
    at=moved.position;
  }
  return Math.hypot(at.x-to.x,at.z-to.z)<.15&&Math.abs(at.y-to.y)<.06;
}

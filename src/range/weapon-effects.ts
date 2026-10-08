import * as THREE from 'three';
import type {Equipment} from './equipment';
import data from './weapon-fx-data.json';
import native from './native-fx-data.json';
import {FX_UNIT, muzzleProfile, tracerDuration, tracerProfile, tracerSegment, type TracerProfile} from './native-fx';
import {SurfaceImpacts} from './surface-impacts';

/** `native`: CS2's per-weapon tracer cadence; `every`: a practice tracer on every round, suppressed guns included. */
export type TracerMode = 'every' | 'native' | 'off';
export function hasTracer(equipment: Equipment, shot: number, mode: TracerMode = 'native') {
  if (mode === 'off' || equipment === 'knife') return false;
  if (mode === 'every') return true;
  const frequency = data.weapons[equipment]?.tracerFrequency ?? 0;
  return !data.weapons[equipment]?.silenced && frequency > 0 && shot % frequency === 0;
}
const tracerLife = {every: .32};

// Unit beam along +Z: a narrow muzzle end widening towards the impact, which keeps
// distant tracers a few pixels wide; vertex colour brightens towards the impact.
function beamGeometry() {
  const geometry = new THREE.CylinderGeometry(1, .06, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, .5);
  const position = geometry.getAttribute('position'), colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) colors.fill(.18 + .82 * position.getZ(i), i * 3, i * 3 + 3);
  return geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Fixed-size pools: firing never allocates geometry, materials or textures. */
export class MuzzleFlashes {
  readonly sprites: THREE.Sprite[] = [];
  readonly glows: THREE.Sprite[] = [];
  readonly smoke: THREE.Sprite[] = [];
  private slots: {anchor?:THREE.Object3D;time:number;life:number;alpha:number;fade:number;size:number;born:number;
    smokeAlpha:number;origin:THREE.Vector3;velocity:THREE.Vector3}[] = [];
  private frame = 0;
  private next = 0;
  private sequence = 0;
  private point = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private textures: THREE.Texture[] = [];
  constructor(private parent: THREE.Object3D, capacity = 8, texture?: THREE.Texture) {
    const load=(url:string)=>{
      const value=texture??(typeof document==='undefined'?new THREE.Texture():new THREE.TextureLoader().load(url));
      value.colorSpace=THREE.SRGBColorSpace;this.textures.push(value);return value;
    };
    const vent=load(native.textures.vent.url);load(native.textures.flame.url);
    const glow=load(native.textures.glow.url), smoke=load(native.textures.smoke.url);
    for(let i=0;i<capacity;i++) {
      const sprite=(name:string,map:THREE.Texture,additive=true)=>{
        const s=new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending,
          depthWrite:false,toneMapped:false}));s.name=name;s.visible=false;s.frustumCulled=false;parent.add(s);return s;
      };
      this.sprites.push(sprite('weapon-muzzle-flame',vent));
      this.glows.push(sprite('weapon-muzzle-glow',glow));
      this.smoke.push(sprite('weapon-muzzle-smoke',smoke,false));
      this.slots.push({time:0,life:0,alpha:0,fade:0,size:0,born:0,smokeAlpha:0,origin:new THREE.Vector3(),velocity:new THREE.Vector3()});
    }
  }
  fire(anchor:THREE.Object3D|undefined,equipment:Equipment,now:number,_world=false) {
    if(!anchor||equipment==='knife'||equipment==='zeus')return;
    const index=this.next;this.next=(index+1)%this.sprites.length;
    const slot=this.slots[index],p=muzzleProfile(equipment),silenced=data.weapons[equipment].silenced;
    // A local sequence varies the appearance without consuming the gameplay RNG.
    const variation=(++this.sequence*.61803398875)%1;
    slot.anchor=anchor;slot.time=now;slot.born=this.frame;
    slot.life=p.life[0]+(p.life[1]-p.life[0])*variation;
    slot.alpha=(p.alpha[0]+(p.alpha[1]-p.alpha[0])*variation)*p.overbright;
    slot.fade=p.fade;slot.size=2*(p.radius[0]+(p.radius[1]-p.radius[0])*variation)*FX_UNIT;
    const flame=this.sprites[index];flame.material.map=this.textures[p.texture==='vent'?0:1];
    flame.visible=true;flame.scale.setScalar(slot.size);flame.material.opacity=slot.alpha;
    flame.material.rotation=p.texture==='vent'?(variation-.5)*Math.PI/6:variation*Math.PI*2;
    const glow=this.glows[index];glow.visible=!silenced;glow.scale.setScalar(slot.size*.7);
    glow.material.color.setRGB(1,.65,.25);glow.material.opacity=.7;
    const smoke=this.smoke[index];smoke.visible=true;smoke.scale.setScalar(slot.size*.7);
    slot.smokeAlpha=silenced?.045:.12;
    smoke.material.color.setRGB(.55,.55,.53);smoke.material.opacity=slot.smokeAlpha;
    smoke.material.rotation=flame.material.rotation;
    this.place(index);slot.origin.copy(flame.position);smoke.position.copy(slot.origin);
    anchor.getWorldQuaternion(this.rotation);
    slot.velocity.set(0,0,1).applyQuaternion(this.rotation).multiplyScalar(110*FX_UNIT);
    // Convert a direction to this scene's coordinates without applying translation.
    parentInverseDirection(this.parent,slot.velocity);
  }
  private place(index:number) {
    const anchor=this.slots[index].anchor;if(!anchor)return;
    anchor.getWorldPosition(this.point);this.parent.worldToLocal(this.point);
    this.sprites[index].position.copy(this.point);this.glows[index].position.copy(this.point);
  }
  update(now:number) {
    for(let i=0;i<this.slots.length;i++) {
      const slot=this.slots[i],age=Math.max(0,now-slot.time),first=this.frame===slot.born;
      const flame=this.sprites[i],glow=this.glows[i],smoke=this.smoke[i];
      if(flame.visible) {
        if(age>=slot.life&&!first) {flame.visible=false;glow.visible=false;slot.anchor=undefined;}
        else {this.place(i);flame.material.opacity=slot.alpha*(first?1:Math.min(1,(slot.life-age)/slot.fade));}
      }
      if(glow.visible&&!first&&age>=.002)glow.visible=false;
      if(smoke.visible) {
        if(age>=native.smoke.life&&!first)smoke.visible=false;
        else {
          const t=Math.min(age,native.smoke.life);
          smoke.position.copy(slot.origin).addScaledVector(slot.velocity,t);
          smoke.position.y+=20*FX_UNIT*t*t;
          smoke.scale.setScalar(slot.size*.7*(1+2*t/native.smoke.life));
          smoke.material.opacity=slot.smokeAlpha*Math.max(0,Math.min(1,(native.smoke.life-t)/native.smoke.fade));
        }
      }
    }
    this.frame++;
  }
  clear(){for(const collection of [this.sprites,this.glows,this.smoke])for(const sprite of collection)sprite.visible=false;for(const slot of this.slots)slot.anchor=undefined;}
  dispose(){for(const collection of [this.sprites,this.glows,this.smoke])for(const sprite of collection){sprite.removeFromParent();sprite.material.dispose();}
    for(const texture of new Set(this.textures))texture.dispose();this.clear();}
}
const inverseRotation=new THREE.Quaternion();
function parentInverseDirection(parent:THREE.Object3D,direction:THREE.Vector3){parent.getWorldQuaternion(inverseRotation);direction.applyQuaternion(inverseRotation.invert());}

export class ShotEffects {
  /** Exact muzzle-to-endpoint lines; `beams` draws the same pool with visible width. */
  readonly tracers: THREE.LineSegments;
  readonly beams: THREE.InstancedMesh;
  readonly impacts: THREE.InstancedMesh;
  readonly flashes: MuzzleFlashes;
  readonly discharges: ElectricDischarges;
  readonly surfaces: SurfaceImpacts;
  private tracePositions: THREE.BufferAttribute;
  private traceColors: THREE.BufferAttribute;
  private traceUntil: Float64Array;
  private traceLife: Float32Array;
  private traceBorn: Uint32Array;
  private traceTint: Float32Array;
  private profiles: (TracerProfile | undefined)[];
  private traceStart: Float64Array;
  private segment = {start:0,end:0,alpha:0};
  private origin = new THREE.Vector3();
  private tip = new THREE.Vector3();
  private impactUntil: Float64Array;
  private nextTrace = 0; private nextImpact = 0; private frame = 0;
  private matrix = new THREE.Matrix4();
  private scale = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private direction = new THREE.Vector3();
  private beamColor = new THREE.Color();
  private static readonly forward = new THREE.Vector3(0, 0, 1);
  constructor(parent: THREE.Object3D, readonly capacity = 64, impactCapacity = 192) {
    this.tracePositions = new THREE.BufferAttribute(new Float32Array(capacity * 6), 3).setUsage(THREE.DynamicDrawUsage);
    this.traceColors = new THREE.BufferAttribute(new Float32Array(capacity * 6), 3).setUsage(THREE.DynamicDrawUsage);
    this.traceTint = new Float32Array(capacity * 3);
    this.profiles=Array(capacity);this.traceStart=new Float64Array(capacity);
    this.traceUntil = new Float64Array(capacity); this.traceLife = new Float32Array(capacity); this.traceBorn = new Uint32Array(capacity);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', this.tracePositions); geometry.setAttribute('color', this.traceColors);
    this.tracers = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({vertexColors: true,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
    this.tracers.name = 'batched-weapon-tracers'; this.tracers.frustumCulled = false; this.tracers.visible = false;
    parent.add(this.tracers);
    this.beams = new THREE.InstancedMesh(beamGeometry(), new THREE.MeshBasicMaterial({vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide}), capacity);
    this.beams.name = 'batched-weapon-tracer-beams'; this.beams.frustumCulled = false; this.beams.visible = false;
    this.beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) {this.beams.setMatrixAt(i, this.matrix); this.beams.setColorAt(i, this.beamColor.setRGB(0, 0, 0));}
    this.beams.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    parent.add(this.beams);
    this.impacts = new THREE.InstancedMesh(new THREE.SphereGeometry(.023, 6, 4), new THREE.MeshBasicMaterial(), impactCapacity);
    this.impacts.name = 'batched-duel-impacts'; this.impacts.frustumCulled = false; this.impacts.count = 0;
    this.impacts.instanceMatrix.setUsage(THREE.DynamicDrawUsage); parent.add(this.impacts);
    this.impactUntil = new Float64Array(impactCapacity);
    this.flashes = new MuzzleFlashes(parent);
    this.discharges = new ElectricDischarges(parent);
    this.surfaces = new SurfaceImpacts(parent);
  }
  trace(equipment: Equipment, shot: number, from: THREE.Vector3, to: THREE.Vector3, now: number, color: THREE.Color, mode: TracerMode = 'native') {
    if (!hasTracer(equipment, shot, mode)) return false;
    if(equipment==='zeus') {this.discharges.fire(from,to,now,shot);return true;}
    const index = this.nextTrace; this.nextTrace = (index + 1) % this.capacity;
    this.tracePositions.setXYZ(index * 2, from.x, from.y, from.z);
    this.tracePositions.setXYZ(index * 2 + 1, to.x, to.y, to.z);
    this.tracePositions.needsUpdate = true;
    const profile=mode==='native'?tracerProfile(equipment):undefined;
    this.profiles[index]=profile;this.traceStart[index]=now;
    const life=profile?Math.max(.001,tracerDuration(profile,from.distanceTo(to))):tracerLife.every;
    this.traceUntil[index] = now + life; this.traceLife[index] = life; this.traceBorn[index] = this.frame;
    this.traceTint[index * 3] = color.r; this.traceTint[index * 3 + 1] = color.g; this.traceTint[index * 3 + 2] = color.b;
    // Wider towards the impact so a 30 m tracer stays visible; capped so close shots stay slim.
    const length = this.direction.subVectors(to, from).length();
    const width = profile ? .004 : Math.min(.06, Math.max(.01, length * .0018));
    this.rotation.setFromUnitVectors(ShotEffects.forward, this.direction.divideScalar(length || 1));
    this.matrix.compose(from, this.rotation, this.scale.set(width, width, length));
    this.beams.setMatrixAt(index, this.matrix); this.beams.instanceMatrix.needsUpdate = true;
    this.tracers.visible = this.beams.visible = true; this.writeColor(index, .7);
    if(profile)this.placeTrace(index,Math.min(life*.5,1/240));
    return true;
  }
  impact(point: THREE.Vector3, size: number, color: THREE.Color, now: number) {
    const index = this.nextImpact; this.nextImpact = (index + 1) % this.impactUntil.length;
    this.matrix.compose(point, this.rotation, this.scale.setScalar(size));
    this.impacts.setMatrixAt(index, this.matrix); this.impacts.setColorAt(index, color);
    this.impacts.instanceMatrix.needsUpdate = true; this.impacts.instanceColor!.needsUpdate = true;
    this.impacts.count = Math.min(this.impacts.count + 1, this.impactUntil.length);
    this.impactUntil[index] = now + 2;
  }
  private writeColor(index: number, alpha: number) {
    const start = index * 3, r = this.traceTint[start] * alpha, g = this.traceTint[start + 1] * alpha, b = this.traceTint[start + 2] * alpha;
    const line=this.profiles[index]?0:1;
    this.traceColors.setXYZ(index * 2, r * .35*line, g * .35*line, b * .35*line);
    this.traceColors.setXYZ(index * 2 + 1, r*line, g*line, b*line); this.traceColors.needsUpdate = true;
    this.beams.setColorAt(index, this.beamColor.setRGB(r * .8, g * .8, b * .8)); this.beams.instanceColor!.needsUpdate = true;
    if (!alpha) {this.matrix.makeScale(0, 0, 0); this.beams.setMatrixAt(index, this.matrix); this.beams.instanceMatrix.needsUpdate = true;}
  }
  private placeTrace(index:number,age:number) {
    const profile=this.profiles[index]!;
    this.origin.fromBufferAttribute(this.tracePositions,index*2);this.tip.fromBufferAttribute(this.tracePositions,index*2+1);
    const distance=this.direction.subVectors(this.tip,this.origin).length();
    tracerSegment(profile,distance,age,this.segment);
    this.direction.divideScalar(distance||1);
    this.origin.addScaledVector(this.direction,this.segment.start);
    this.rotation.setFromUnitVectors(ShotEffects.forward,this.direction);
    const width=profile.kind==='trail'?Math.max(.002,Math.min(.012,profile.radius*FX_UNIT*profile.radiusScale)):.004;
    this.matrix.compose(this.origin,this.rotation,this.scale.set(width,width,Math.max(0,this.segment.end-this.segment.start)));
    this.beams.setMatrixAt(index,this.matrix);this.beams.instanceMatrix.needsUpdate=true;
    this.writeColor(index,this.segment.alpha);
  }
  update(now: number) {
    let visible = false;
    for (let i = 0; i < this.capacity; i++) if (this.traceUntil[i]) {
      const remaining = this.traceUntil[i] - now;
      if (remaining <= 0 && this.frame > this.traceBorn[i]) {this.traceUntil[i] = 0; this.writeColor(i, 0);}
      else {visible = true;
        if(this.profiles[i]) {
          // Preserve a visible first presentation even if an entire native trail elapsed between frames.
          const age=now-this.traceStart[i],first=this.frame===this.traceBorn[i];
          this.placeTrace(i,first?Math.max(Math.min(this.traceLife[i]*.5,1/240),Math.min(age,this.traceLife[i]*.9)):age);
        } else this.writeColor(i,Math.max(.15,remaining/this.traceLife[i])*.7);
      }
    }
    this.tracers.visible = this.beams.visible = visible;
    for (let i = 0; i < this.impacts.count; i++) if (this.impactUntil[i] && now >= this.impactUntil[i]) {
      this.impactUntil[i] = 0; this.matrix.makeScale(0, 0, 0); this.impacts.setMatrixAt(i, this.matrix); this.impacts.instanceMatrix.needsUpdate = true;
    }
    this.flashes.update(now); this.discharges.update(now);this.surfaces.update(now); this.frame++;
  }
  clear() {
    this.traceUntil.fill(0); (this.traceColors.array as Float32Array).fill(0); this.traceColors.needsUpdate = true;
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < this.capacity; i++) this.beams.setMatrixAt(i, this.matrix);
    this.beams.instanceMatrix.needsUpdate = true;
    this.tracers.visible = this.beams.visible = false; this.impacts.count = 0; this.impactUntil.fill(0);
    this.nextTrace = this.nextImpact = 0; this.flashes.clear();
    this.discharges.clear();this.surfaces.clear();
  }
  dispose() {
    this.tracers.removeFromParent(); this.tracers.geometry.dispose(); (this.tracers.material as THREE.Material).dispose();
    this.beams.removeFromParent(); this.beams.geometry.dispose(); (this.beams.material as THREE.Material).dispose(); this.beams.dispose();
    this.impacts.removeFromParent(); this.impacts.geometry.dispose(); (this.impacts.material as THREE.Material).dispose(); this.impacts.dispose();
    this.flashes.dispose();
    this.discharges.dispose();this.surfaces.dispose();
  }
}

// Two short rope-like wires follow the native taser particle structure.
// Their tessellation, colour and lifetime are browser presentation estimates.
export class ElectricDischarges {
  readonly wires:THREE.LineSegments;
  private positions=new THREE.BufferAttribute(new Float32Array(8*2*12*6),3).setUsage(THREE.DynamicDrawUsage);
  private colors=new THREE.BufferAttribute(new Float32Array(8*2*12*6),3).setUsage(THREE.DynamicDrawUsage);
  private until=new Float64Array(8);
  private born=new Uint32Array(8);
  private next=0;private frame=0;
  private delta=new THREE.Vector3();private lateral=new THREE.Vector3();private vertical=new THREE.Vector3();
  constructor(parent:THREE.Object3D) {
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',this.positions);geometry.setAttribute('color',this.colors);
    this.wires=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,
      blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
    this.wires.name='pooled-taser-wires';this.wires.visible=false;this.wires.frustumCulled=false;parent.add(this.wires);
  }
  fire(from:THREE.Vector3,to:THREE.Vector3,now:number,seed:number) {
    const slot=this.next;this.next=(slot+1)%8;this.until[slot]=now+.075;this.born[slot]=this.frame;
    this.delta.copy(to).sub(from);this.lateral.set(this.delta.z,0,-this.delta.x).normalize();
    if(!this.lateral.lengthSq())this.lateral.set(1,0,0);
    this.vertical.crossVectors(this.delta,this.lateral).normalize();
    for(let wire=0;wire<2;wire++)for(let segment=0;segment<12;segment++)for(let end=0;end<2;end++) {
      const step=segment+end,t=step/12,envelope=Math.sin(Math.PI*t),phase=step*2.47+seed*1.91+wire*3.7;
      const x=Math.sin(phase)*.025*envelope,z=Math.cos(phase*1.7)*.022*envelope;
      this.positions.setXYZ(slot*48+wire*24+segment*2+end,from.x+this.delta.x*t+this.lateral.x*x+this.vertical.x*z,
        from.y+this.delta.y*t+this.lateral.y*x+this.vertical.y*z,from.z+this.delta.z*t+this.lateral.z*x+this.vertical.z*z);
    }
    this.positions.needsUpdate=true;this.tint(slot,1);this.wires.visible=true;
  }
  private tint(slot:number,alpha:number) {
    for(let vertex=0;vertex<48;vertex++)this.colors.setXYZ(slot*48+vertex,.62*alpha,.85*alpha,alpha);
    this.colors.needsUpdate=true;
  }
  update(now:number) {
    let visible=false;
    for(let slot=0;slot<8;slot++)if(this.until[slot]) {
      const left=this.until[slot]-now;
      if(left<=0&&this.frame>this.born[slot]){this.until[slot]=0;this.tint(slot,0);}
      else{visible=true;this.tint(slot,Math.max(.2,left/.075));}
    }
    this.wires.visible=visible;this.frame++;
  }
  clear(){this.until.fill(0);(this.colors.array as Float32Array).fill(0);this.colors.needsUpdate=true;this.wires.visible=false;}
  dispose(){this.wires.removeFromParent();this.wires.geometry.dispose();(this.wires.material as THREE.Material).dispose();}
}

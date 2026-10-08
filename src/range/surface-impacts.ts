import * as THREE from 'three';
import textures from './impact-textures.json';
import type {Vec} from './actor-physics';

type MaterialKind=keyof typeof textures.textures;
/** Bounded cosmetic decals; collision and damage never read these meshes. */
export class SurfaceImpacts {
  readonly pools = new Map<MaterialKind,{mesh:THREE.InstancedMesh;until:Float64Array;next:number}>();
  private geometry=new THREE.PlaneGeometry(1,1);
  private matrix=new THREE.Matrix4();
  private point=new THREE.Vector3();
  private normal=new THREE.Vector3();
  private rotation=new THREE.Quaternion();
  private spin=new THREE.Quaternion();
  private scale=new THREE.Vector3();
  private static readonly forward=new THREE.Vector3(0,0,1);
  constructor(parent:THREE.Object3D,capacity=48) {
    for(const [kind,data] of Object.entries(textures.textures)) {
      const map=typeof document==='undefined'?new THREE.Texture():new THREE.TextureLoader().load(data.url);
      map.colorSpace=THREE.SRGBColorSpace;
      const mesh=new THREE.InstancedMesh(this.geometry,new THREE.MeshStandardMaterial({map,transparent:true,
        alphaTest:.015,depthWrite:false,roughness:kind==='metal'?.45:.9,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}),capacity);
      mesh.name=`surface-impacts-${kind}`;mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent.add(mesh);this.pools.set(kind as MaterialKind,{mesh,until:new Float64Array(capacity),next:0});
    }
  }
  fire(point:Vec,normal:Vec,material:string|undefined,size:number,now:number) {
    this.normal.set(normal.x,normal.y,normal.z);
    if(!Number.isFinite(this.normal.lengthSq())||this.normal.lengthSq()<1e-8||material==='water'||material==='flesh')return false;
    this.normal.normalize();
    const kind:MaterialKind=material==='wood'?'wood':material==='glass'?'glass':material==='metal'||material==='grate'?'metal':'concrete';
    const pool=this.pools.get(kind)!,index=pool.next;pool.next=(index+1)%pool.until.length;
    this.point.set(point.x,point.y,point.z).addScaledVector(this.normal,.001);
    this.rotation.setFromUnitVectors(SurfaceImpacts.forward,this.normal);
    this.spin.setFromAxisAngle(SurfaceImpacts.forward,index*2.39996);this.rotation.multiply(this.spin);
    // Sizes and retention are trainer presentation settings; native decal shaders are not reproduced.
    const diameter=(kind==='glass'?.12:kind==='wood'?.065:.055)*Math.max(.5,Math.min(4,size));
    this.matrix.compose(this.point,this.rotation,this.scale.set(diameter,diameter,1));
    pool.mesh.setMatrixAt(index,this.matrix);pool.mesh.instanceMatrix.needsUpdate=true;
    pool.mesh.count=Math.min(pool.mesh.count+1,pool.until.length);pool.until[index]=now+20;return true;
  }
  update(now:number) {
    for(const pool of this.pools.values())for(let i=0;i<pool.mesh.count;i++)if(pool.until[i]&&now>=pool.until[i]) {
      pool.until[i]=0;this.matrix.makeScale(0,0,0);pool.mesh.setMatrixAt(i,this.matrix);pool.mesh.instanceMatrix.needsUpdate=true;
    }
  }
  clear(){for(const pool of this.pools.values()){pool.mesh.count=0;pool.next=0;pool.until.fill(0);}}
  dispose(){for(const pool of this.pools.values()){pool.mesh.removeFromParent();const m=pool.mesh.material as THREE.MeshStandardMaterial;m.map?.dispose();m.dispose();pool.mesh.dispose();}
    this.geometry.dispose();this.pools.clear();}
}

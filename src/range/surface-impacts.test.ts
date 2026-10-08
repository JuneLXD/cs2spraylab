import {describe,expect,it} from 'vitest';
import {Group,Matrix4,Quaternion,Vector3} from 'three';
import {SurfaceImpacts} from './surface-impacts';

describe('surface-attached impact presentation',()=>{
 it('aligns a native material decal with the contact normal and offsets it outside cover',()=>{
   const fx=new SurfaceImpacts(new Group(),4),point={x:3,y:2,z:1},normal={x:-1,y:0,z:0};
   expect(fx.fire(point,normal,'wood',1,0)).toBe(true);
   const pool=fx.pools.get('wood')!,matrix=new Matrix4(),position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();
   pool.mesh.getMatrixAt(0,matrix);matrix.decompose(position,rotation,scale);
   expect(position.x).toBeCloseTo(2.999);expect(position.y).toBe(2);expect(position.z).toBe(1);
   expect(new Vector3(0,0,1).applyQuaternion(rotation).distanceTo(new Vector3(-1,0,0))).toBeLessThan(1e-6);
   expect(fx.pools.get('metal')!.mesh.count).toBe(0);expect(point).toEqual({x:3,y:2,z:1});fx.dispose();
 });
 it('bounds allocation across long sprays and clears expired surfaces',()=>{
   const scene=new Group(),fx=new SurfaceImpacts(scene,4),pool=fx.pools.get('metal')!,geometry=pool.mesh.geometry;
   for(let i=0;i<1000;i++)fx.fire({x:i,y:0,z:0},{x:0,y:1,z:0},'metal',1,i*.01);
   expect(pool.mesh.count).toBe(4);expect(pool.mesh.geometry).toBe(geometry);expect(scene.children).toHaveLength(4);
   fx.update(40);const matrix=new Matrix4();pool.mesh.getMatrixAt(0,matrix);expect(matrix.elements[0]).toBe(0);
   fx.clear();expect(pool.mesh.count).toBe(0);fx.dispose();expect(scene.children).toHaveLength(0);
 });
});

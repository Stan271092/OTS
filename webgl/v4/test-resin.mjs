import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three.module.js';

let model;
try { model = await import('./resin-model.mjs'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

test('resin model is available', () => assert.ok(model, 'Implement resin-model.mjs'));

test('selected spheres retain anchors while one black and one clear accent grow', () => {
  assert.equal(typeof model.selectDrops,'function','Implement reduced composition');
  const data=JSON.parse(readFileSync(new URL('../resin-geometry.json',import.meta.url)));
  const original=structuredClone(data);
  const items=model.selectDrops(data), black=items.filter(d=>d.kind==='black');
  assert.equal(black.length,7);
  assert.equal(items.filter(d=>d.kind==='clear').length,3);
  assert.equal(new Set(items.map(d=>d.name)).size,items.length);
  assert.ok(black.some(d=>d.position[0]<-.7)&&black.some(d=>d.position[0]>.7));
  assert.ok(black.some(d=>d.position[1]<-1)&&black.some(d=>d.position[1]>1));
  assert.ok(black.some(d=>d.position[2]>.5)&&black.some(d=>d.position[2]<0));
  for (const drop of black) {
    const source=data.spheres.find(d=>d.name===drop.name);
    assert.deepEqual(drop.position,source.position);
    assert.ok(drop.radius<=source.radius*1.3,'Keep accent growth moderate');
    assert.equal(drop.motionIndex,data.spheres.indexOf(source));
  }
  for(const kind of ['black','clear']){
    const source=kind==='black'?data.spheres:data.beads;
    const grown=items.filter(d=>d.kind===kind&&d.radius>source.find(s=>s.name===d.name).radius*.92*1.05);
    assert.equal(grown.length,1,'Exactly one accent grows per kind');
    assert.ok(grown[0].radius/source.find(s=>s.name===grown[0].name).radius/.92>1.15);
  }
  assert.deepEqual(data,original,'Selecting spheres must not mutate imported geometry');
});

test('flow is local, bounded and smooth rather than uniform scaling', { skip: !model }, () => {
  const points = [[1,0,0], [0,1,0], [0,0,1], [-1,.3,.4]];
  let movement = 0;
  for (const point of points) {
    const start = model.flowPoint(point, 0);
    const later = model.flowPoint(point, 8);
    movement += Math.hypot(...later.map((value,i) => value-start[i]));
    for (const t of [0, 3, 18, 120, 900]) {
      const a = model.flowPoint(point,t), b = model.flowPoint(point,t+.01);
      assert.ok(a.every(Number.isFinite));
      assert.ok(Math.hypot(...a.map((value,i) => value-point[i])) < .3);
      assert.ok(Math.hypot(...a.map((value,i) => value-b[i])) < .002);
    }
  }
  assert.ok(movement > .08, 'Contour must visibly change over several seconds');
  assert.ok(Math.abs(model.flowPoint([1,0,0],8)[1]) > .005, 'Not just radial scaling');
});

test('local flow preserves volume instead of inflating and deflating the resin',()=>{
  const h=1e-5;
  for(const time of [0,4,13,40])for(const p of [[.2,.7,-.3],[-1,.4,.8],[.6,-.8,.2]]){
    const start=model.flowPoint(p,time),columns=[0,1,2].map(axis=>{
      const q=[...p];q[axis]+=h;
      return model.flowPoint(q,time).map((v,i)=>(v-start[i])/h);
    });
    const [a,b,c]=columns;
    const determinant=a[0]*(b[1]*c[2]-b[2]*c[1])-b[0]*(a[1]*c[2]-a[2]*c[1])+c[0]*(a[1]*b[2]-a[2]*b[1]);
    assert.ok(Math.abs(determinant-1)<.0001,'Incompressible resin must redistribute rather than pulse in volume');
  }
});

test('viscous lobes visibly redistribute within six seconds without rapid jitter',()=>{
  const data=JSON.parse(readFileSync(new URL('../resin-geometry.json',import.meta.url)));
  let distance=0,count=0;
  for(let i=0;i<data.positions.length;i+=69){
    const p=data.positions.slice(i,i+3);if(p.length!==3)continue;
    const a=model.flowPoint(p,0),b=model.flowPoint(p,6),next=model.flowPoint(p,6.01);
    distance+=Math.hypot(...a.map((v,k)=>v-b[k]));count++;
    assert.ok(Math.hypot(...next.map((v,k)=>v-b[k]))<.004,'Viscous motion should not jitter');
  }
  assert.ok(distance/count>.12,'Main body is too static');
});

test('powder contains visible crumbs as well as dispersed fine grains',()=>{
  const grains=model.makePowder(4600),fine=grains.filter(g=>g.radius<.009),coarse=grains.filter(g=>g.radius>.018);
  assert.ok(fine.length>grains.length*.5,'Keep mostly fine powder');
  assert.ok(coarse.length>grains.length*.08,'Add readable irregular crumbs, not an invisible mist');
  assert.ok(coarse.length<grains.length*.3,'Do not turn powder into pebbles');
  for(let cluster=0;cluster<4;cluster++)assert.ok(coarse.filter(g=>g.cluster===cluster).length>50,'Every cloud needs both fine and coarse grains');
});

test('deformed normals stay perpendicular to the warped surface', { skip: !model }, () => {
  const h = 1e-4;
  for (const time of [0, 5, 35]) for (const p of [[.2,.7,-.3],[-1,.4,.8]]) {
    const n = model.flowNormal(p,[0,0,1],time);
    assert.ok(Math.abs(Math.hypot(...n)-1) < 1e-6);
    const a = model.flowPoint(p,time);
    for (const axis of [0,1]) {
      const offset = [...p]; offset[axis] += h;
      const b = model.flowPoint(offset,time);
      assert.ok(Math.abs(n.reduce((sum,value,i) => sum+value*(b[i]-a[i])/h,0)) < .001);
    }
  }
});

test('powder is deterministic, finite and moves with individual grain drift', { skip: !model }, () => {
  const grains = model.makePowder(100);
  assert.equal(grains.length,100);
  assert.deepEqual(grains,model.makePowder(100));
  assert.equal(new Set(grains.map(g => g.cluster)).size,4);
  const deltas = grains.map(g => {
    assert.ok(g.radius > 0 && g.radius < .034);
    const a=model.powderPoint(g,0), b=model.powderPoint(g,12);
    assert.ok([...a,...b].every(Number.isFinite));
    assert.ok(Math.hypot(...b.map((v,i)=>v-a[i])) < .62);
    return b.map((v,i)=>v-a[i]);
  });
  assert.notDeepEqual(deltas[0],deltas[4]);
});

test('powder anchors remain inside the actual fused Blender volume', { skip: !model }, () => {
  const data=JSON.parse(readFileSync(new URL('../resin-geometry.json',import.meta.url)));
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
  geometry.setIndex(data.indices);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  mesh.updateMatrixWorld();
  const ray=new THREE.Raycaster(),direction=new THREE.Vector3(0,0,1);
  for (const grain of model.makePowder(4600,data.clusters).filter((_,i)=>i%47===0)) {
    ray.set(new THREE.Vector3(...grain.position),direction);
    const hit=ray.intersectObject(mesh)[0];
    assert.ok(hit && hit.face.normal.z>0 && hit.distance>.018,'Powder leaks out of the resin');
  }
  geometry.dispose();mesh.material.dispose();
});

test('render resolution stays within the pixel budget on large screens', { skip: !model }, () => {
  for (const [w,h] of [[676,650],[3840,2160],[7680,4320],[288,470]]) {
    for (const quality of ['eco','detail']) {
      const ratio=model.renderRatio(w,h,quality);
      assert.ok(ratio>0);
      assert.ok(Math.floor(w*ratio)*Math.floor(h*ratio) <= 1600000);
    }
  }
});

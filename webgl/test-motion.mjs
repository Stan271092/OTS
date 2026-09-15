import { test } from 'node:test';
import assert from 'node:assert/strict';
// Black sphere's motion relative to other spheres and grains must change, not
// just a transform applied to the whole composition.
const module = await import('./motion.mjs').catch(()=>null);
test('motion model exists',()=>assert.ok(module,'Real independent motion model not implemented'));
if(module){
 const {spherePosition, grainPosition, resinPose} = module;
 const dist=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
 test('spheres move independently',()=>{
  const baseA=[1,1,.1],baseB=[-1,.4,-.1];
  assert.notDeepEqual(spherePosition(baseA,0,0),spherePosition(baseA,0,4));
  assert.ok(Math.abs(dist(spherePosition(baseA,0,0),spherePosition(baseB,1,0))-dist(spherePosition(baseA,0,4),spherePosition(baseB,1,4)))>.02);
 });
 test('grains drift relative to their own cluster',()=>{
  const base=[.2,.3,.4,.01,.08];
  assert.notDeepEqual(grainPosition(base,0,2,0),grainPosition(base,0,2,5));
  const a=grainPosition(base,0,2,3),b=grainPosition(base,7,2,3);
  assert.ok(dist(a,b)>.001);
 });
 test('motion remains inside seed clearance at all sampled times',()=>{
  const base=[.2,.3,.4,.01,.07];
  for(let i=0;i<60;i++) for(let t=0;t<=100;t+=3){
   const pos=grainPosition(base,i,i%4,t);
   assert.ok(dist(pos,base.slice(0,3))+base[3]<base[4]-.004,'Grain crosses boundary');
   assert.ok(pos.every(Number.isFinite));
  }
 });
 test('deterministic motion can pause without drift',()=>{
  assert.deepEqual(grainPosition([1,2,3,.01,.08],7,1,2),grainPosition([1,2,3,.01,.08],7,1,2));
  assert.notDeepEqual(resinPose(0),resinPose(4));
 });
}

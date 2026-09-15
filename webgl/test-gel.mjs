import { test } from 'node:test';
import assert from 'node:assert/strict';
const model = await import('./gel-model.mjs').catch(() => null);
const distance = (a,b) => Math.hypot(...a.map((v,i)=>v-b[i]));
test('gel composition is implemented', () => assert.ok(model, 'Missing clear capsule composition'));
if (model) {
  const { composition, capsulePoint, dropPosition, powderPosition, makePowder, floatingPose, surfacePoint, surfaceNormal } = model;
  test('central capsule dominates a compact mixed asymmetric cluster', () => {
    assert.ok(composition.radius > 1);
    const drops = composition.drops;
    assert.ok(drops.filter(d=>d.kind==='clear').length>=5);
    assert.ok(drops.filter(d=>d.kind==='black').length>=6);
    assert.ok(drops.every(d=>d.radius<composition.radius*.6));
    for (let t=0;t<600;t+=13) for (const [i,d] of drops.entries()) {
      assert.ok(Math.hypot(...dropPosition(d,i,t))+d.radius<2.35,'Satellite leaves compact composition');
    }
    assert.ok(Math.abs(drops.reduce((s,d)=>s+d.position[0]*d.radius,0))>.05);
  });
  test('capsule stays rounded but deforms smoothly and deterministically', () => {
    let change=0;
    for(let i=0;i<100;i++) {
      const z=1-2*(i+.5)/100,a=i*2.39996,s=Math.sqrt(1-z*z),u=[s*Math.cos(a),z,s*Math.sin(a)];
      for (let t=0;t<200;t+=7) {
        const p=capsulePoint(u,t);
        assert.ok(p.every(Number.isFinite));
        assert.ok(Math.hypot(...p)>1.0 && Math.hypot(...p)<1.46,'Deformation collapses or over-expands capsule');
        assert.ok(distance(p,capsulePoint(u,t+.01))<.001,'Surface jumps');
      }
      change+=distance(capsulePoint(u,0),capsulePoint(u,10));
      assert.deepEqual(capsulePoint(u,3),capsulePoint(u,3));
    }
    assert.ok(change>4,'Contour waves are too subtle to read as viscous gel');
  });
  test('drops drift independently with low continuous velocity', () => {
    const [a,b]=composition.drops;
    const d0=distance(dropPosition(a,0,0),dropPosition(b,1,0));
    const d1=distance(dropPosition(a,0,20),dropPosition(b,1,20));
    assert.ok(Math.abs(d0-d1)>.003,'Only common rotation, no independent motion');
    for(let t=0;t<300;t+=3)for(const [i,d] of composition.drops.entries()) {
      assert.ok(distance(dropPosition(d,i,t),dropPosition(d,i,t+.01))<.001);
    }
    assert.notDeepEqual(floatingPose(0),floatingPose(20));
  });
  test('all powder stays inside the softly deforming capsule', () => {
    const grains=makePowder(1600);
    assert.equal(grains.length,1600);
    assert.equal(new Set(grains.map(g=>g.cluster)).size,4);
    assert.deepEqual(makePowder(20),makePowder(20));
    for(const g of grains)for(let t=0;t<100;t+=17) {
      const p=powderPosition(g,t),length=Math.hypot(...p),unit=p.map(x=>x/length);
      assert.ok(length+g.radius+.02<Math.hypot(...capsulePoint(unit,t)),'Powder escapes moving capsule surface');
    }
    assert.notDeepEqual(powderPosition(grains[0],0),powderPosition(grains[0],10));
  });
  test('small drops are subordinate and powder is denser',()=>{
    assert.ok(Math.max(...composition.drops.map(d=>d.radius))<.49);
    assert.ok(makePowder().length>=2000);
  });
  test('satellite contours change shape, not only their scale',()=>{
    assert.equal(typeof surfacePoint,'function');
    const diagonal=[Math.SQRT1_2,Math.SQRT1_2,0];
    const a=Math.hypot(...surfacePoint([1,0,0],0,3));
    const b=Math.hypot(...surfacePoint(diagonal,0,3));
    const c=Math.hypot(...surfacePoint([1,0,0],10,3));
    const d=Math.hypot(...surfacePoint(diagonal,10,3));
    assert.ok(Math.abs(a/b-c/d)>.025,'Only whole-drop scaling');
  });
  test('deformed normals agree with surface tangents, including sphere seam',()=>{
    assert.equal(typeof surfaceNormal,'function');
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const normalize=a=>{const l=Math.hypot(...a);return a.map(v=>v/l)};
    const sub=(a,b)=>a.map((v,i)=>v-b[i]);
    for(const u of [[1,0,0],[0,1,0],[0,0,1],[.6,.8,0]])for(const time of [0,3,15]) {
      const n=surfaceNormal(u,time,2);
      const tangent=normalize(cross(u,Math.abs(u[1])>.9?[1,0,0]:[0,1,0]));
      const bitangent=cross(u,tangent);
      const p=surfacePoint(u,time,2);
      const t=sub(surfacePoint(normalize(u.map((v,i)=>v+.0001*tangent[i])),time,2),p);
      const b=sub(surfacePoint(normalize(u.map((v,i)=>v+.0001*bitangent[i])),time,2),p);
      const expected=normalize(cross(t,b));
      assert.ok(Math.abs(n.reduce((s,v,i)=>s+v*expected[i],0))>.999,'Incorrect lighting normal on waves');
    }
  });
}

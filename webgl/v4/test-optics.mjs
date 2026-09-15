import test from 'node:test';
import assert from 'node:assert/strict';
let optics;
try { optics=await import('./optics.mjs'); } catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error; }

test('clear volume accounts for both interfaces, not just the front skin',()=>{
  assert.ok(optics,'Implement volume optics');
  const normal=optics.volumeReflectance(1,1.535);
  assert.ok(normal>.085&&normal<.086,'Normal-incidence reflectance of two clear boundaries');
  assert.equal(optics.volumeReflectance(0,1.535),1);
  assert.equal(optics.volumeReflectance(1,1),0);
  let previous=1;
  for(let i=0;i<=100;i++) {
    const r=optics.volumeReflectance(i/100,1.535);
    assert.ok(r>=0&&r<=1&&r<=previous);previous=r;
  }
});

test('known-background resin retains a readable rim without an opaque outline',()=>{
  const rim=optics.surfaceReflectance(0,1.535);
  assert.ok(rim>.65&&rim<.85,'Rim must contrast with transmitted bright background but retain transmission');
  assert.ok(optics.surfaceReflectance(1,1.535)>.06&&optics.surfaceReflectance(1,1.535)<.09,'Keep the body clear');
});

test('bounded internal ray distance separates front, internal and rear inclusions',()=>{
  assert.ok(optics);
  // Entry z=-5, exit z=-7, internal ray points toward -z.
  assert.equal(optics.inclusionDistance(-4,-5,-1,2),0);
  assert.equal(optics.inclusionDistance(-6,-5,-1,2),1);
  assert.equal(optics.inclusionDistance(-9,-5,-1,2),2);
  assert.equal(optics.inclusionDistance(-6,-5,0,2),2);
  assert.equal(optics.inclusionDistance(-6,-5,-1,0),0);
});

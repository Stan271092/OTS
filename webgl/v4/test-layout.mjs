import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import {selectDrops,dropPoint,floatingPose,flowPoint} from './resin-model.mjs';
import {separateDrops,projectLocal} from './layout.mjs';
const data=JSON.parse(readFileSync(new URL('../resin-geometry.json',import.meta.url)));
const drops=separateDrops(data,selectDrops(data));
const radius=drop=>drop.radius*(drop.kind==='clear'?1.32:1);

test('a large clear drop stays close in front, while the small clear paths stay compact',()=>{
  const hero=drops.find(d=>d.hero);
  assert.ok(hero,'Add the prominent foreground clear drop');
  assert.ok(hero.radius>=.58&&hero.radius<=.7);
  for(let time=0;time<=300;time+=2){
    const p=projectLocal(dropPoint(hero,hero.motionIndex,time));
    assert.ok(Math.abs(p[0])<.75&&p[1]>-1.3&&p[1]<.2,'Hero must overlap the main resin, not orbit away');
    assert.ok(p[2]>1.9&&p[2]<2.65,'Hero must stay just ahead of the volume');
    for(const drop of drops.filter(d=>d.kind==='clear'&&!d.hero)){
      const q=projectLocal(dropPoint(drop,drop.motionIndex,time));
      assert.ok(Math.abs(q[0])+radius(drop)<2.9,'Small clear sphere drifts too far sideways');
    }
  }
});
const vertices=time=>Array.from({length:data.positions.length/3},(_,i)=>
  new THREE.Vector3(...flowPoint(data.positions.slice(i*3,i*3+3),time)));

test('satellites stay outside the deformed resin with a real 3D gap',()=>{
  const triangle=new THREE.Triangle(),point=new THREE.Vector3(),nearest=new THREE.Vector3();
  const ray=new THREE.Ray(),hit=new THREE.Vector3(),direction=new THREE.Vector3(.8123,.3197,.4871).normalize();
  for(const time of [0,4,12,35,90,180]){
    const mesh=vertices(time);
    for(const drop of drops){
      point.fromArray(dropPoint(drop,drop.motionIndex,time));ray.set(point,direction);
      let distance=Infinity,crossings=0;
      for(let k=0;k<data.indices.length;k+=3){
        triangle.set(mesh[data.indices[k]],mesh[data.indices[k+1]],mesh[data.indices[k+2]]);
        triangle.closestPointToPoint(point,nearest);distance=Math.min(distance,point.distanceTo(nearest));
        if(ray.intersectTriangle(triangle.a,triangle.b,triangle.c,false,hit))crossings++;
      }
      assert.equal(crossings%2,0,`${drop.name} is inside resin at ${time}`);
      assert.ok(distance-radius(drop)>.04,`${drop.name} touches resin at ${time}: gap ${distance-radius(drop)}`);
    }
  }
});

test('the entire compact path and nearby hero clear the deformation envelope',()=>{
  const mesh=vertices(0);
  // Use the undeformed mesh here; .30 bounds all sequential shear displacement.
  mesh.forEach((v,i)=>v.fromArray(data.positions,i*3));
  const triangle=new THREE.Triangle(),point=new THREE.Vector3(),nearest=new THREE.Vector3();
  const distance=p=>{
    point.fromArray(p);let best=Infinity;
    for(let i=0;i<data.indices.length;i+=3){
      triangle.set(mesh[data.indices[i]],mesh[data.indices[i+1]],mesh[data.indices[i+2]]);
      triangle.closestPointToPoint(point,nearest);best=Math.min(best,point.distanceTo(nearest));
    }
    return best;
  };
  const path=drops.find(d=>!d.hero&&d.kind==='clear');
  const largest=Math.max(...drops.filter(d=>!d.hero).map(radius));
  let minimum=Infinity;
  for(let i=0;i<360;i++)minimum=Math.min(minimum,distance(dropPoint(path,path.motionIndex,i*2*Math.PI/(360*.045))));
  // Speed per radian <=sqrt(2.1²+2.2²+1.2²); nearest sample <=pi/360 away.
  assert.ok(minimum-.3-largest-Math.hypot(2.1,2.2,1.2)*Math.PI/360>.04,'Close orbit loses its clearance between frames');
  const hero=drops.find(d=>d.hero);
  assert.ok(distance(hero.orbit.center)-.3-radius(hero)-.05>.04,'Hero envelope touches the body');
});

test('independent satellites never collide or jump, including after many revolutions',()=>{
  for(let time=0;time<=1800;time+=.5){
    const points=drops.map(d=>dropPoint(d,d.motionIndex,time));
    drops.forEach((drop,i)=>{
      const next=dropPoint(drop,drop.motionIndex,time+.01);
      assert.ok(Math.hypot(...next.map((v,k)=>v-points[i][k]))<.005,'Satellite jumps');
      for(let j=0;j<i;j++)assert.ok(Math.hypot(...points[i].map((v,k)=>v-points[j][k]))-radius(drop)-radius(drops[j])>.025,'Small spheres touch');
    });
  }
});

test('both kinds visibly cross in front of and behind the actual resin silhouette',()=>{
  const triangle=new THREE.Triangle(),point=new THREE.Vector3(),nearest=new THREE.Vector3();
  const seen=new Map(drops.map(d=>[d.name,new Set()]));
  for(let time=0;time<=210;time+=3){
    const mesh=vertices(time).map(v=>projectLocal(v.toArray()));
    const minZ=Math.min(...mesh.map(v=>v[2])),maxZ=Math.max(...mesh.map(v=>v[2]));
    for(const drop of drops){
      const p=projectLocal(dropPoint(drop,drop.motionIndex,time));
      const side=p[2]-radius(drop)>maxZ?'front':p[2]+radius(drop)<minZ?'rear':null;
      if(!side||seen.get(drop.name).has(side))continue;
      point.set(p[0],p[1],0);
      for(let k=0;k<data.indices.length;k+=3){
        const [a,b,c]=data.indices.slice(k,k+3).map(i=>mesh[i]);
        triangle.a.set(a[0],a[1],0);triangle.b.set(b[0],b[1],0);triangle.c.set(c[0],c[1],0);
        if(triangle.getArea()<1e-9)continue;
        triangle.closestPointToPoint(point,nearest);
        if(point.distanceTo(nearest)<1e-6){seen.get(drop.name).add(side);break;}
      }
    }
  }
  for(const drop of drops)assert.equal(seen.get(drop.name).size,drop.hero?1:2,`${drop.name} does not occupy the intended side(s) of silhouette`);
});

test('small satellites remain perceptible while the large foreground drop drifts slowly',()=>{
  for(const drop of drops){
    if(drop.hero){
      const a=dropPoint(drop,drop.motionIndex,0),b=dropPoint(drop,drop.motionIndex,6);
      const distance=Math.hypot(...a.map((v,i)=>v-b[i]));
      assert.ok(distance>.02&&distance<.1,'Hero must drift gently, not rush around');continue;
    }
    let length=0,p=dropPoint(drop,drop.motionIndex,0);
    const later=dropPoint(drop,drop.motionIndex,3);
    assert.ok(Math.hypot(...later.map((v,i)=>v-p[i]))>.25,`${drop.name} only trembles in place`);
    for(let t=.1;t<=60;t+=.1){const q=dropPoint(drop,drop.motionIndex,t);length+=Math.hypot(...q.map((v,i)=>v-p[i]));p=q;}
    assert.ok(length/60<.14,'Shared close paths should remain slow');
  }
});

test('satellites occupy higher and lower lanes without rushing',()=>{
  const heights=[0,10,20].flatMap(t=>drops.map(d=>projectLocal(dropPoint(d,d.motionIndex,t))[1]));
  assert.ok(Math.max(...heights)>1.3,'Lift some small spheres');
  assert.ok(Math.min(...heights)<-1,'Lower some small spheres');
  for(const drop of drops){
    const start=dropPoint(drop,drop.motionIndex,0),end=dropPoint(drop,drop.motionIndex,1);
    assert.ok(Math.hypot(...end.map((v,i)=>v-start[i]))<.17,'Slow the satellite animation');
  }
});

test('floating keeps its rotation fixed while the body lifts',()=>{
  const first=floatingPose(0);
  for(const t of [1,6,14,40,180]){
    const pose=floatingPose(t);
    assert.deepEqual([pose.x,pose.y,pose.z],[first.x,first.y,first.z]);
  }
  assert.notEqual(first.lift,floatingPose(6).lift);
});

import * as THREE from '../vendor/three.module.js';
import {dropPoint} from './resin-model.mjs';

export const fixedView={yaw:-.6,roll:-.045,direction:[.218,.213,.95]};
const cameraRotation=new THREE.Matrix4().lookAt(new THREE.Vector3(...fixedView.direction),new THREE.Vector3(),new THREE.Vector3(0,1,0));
const toView=cameraRotation.clone().invert()
  .multiply(new THREE.Matrix4().makeRotationY(fixedView.yaw))
  .multiply(new THREE.Matrix4().makeRotationZ(fixedView.roll));
const fromView=toView.clone().invert();
export const projectLocal=point=>new THREE.Vector3(...point).applyMatrix4(toView).toArray();
const local=point=>new THREE.Vector3(...point).applyMatrix4(fromView).toArray();

export function separateDrops(data,drops) {
  // A shared inclined ellipse stays close to the resin. Its raised front arc
  // leaves space for the large lower-front drop; bounded phase wobble cannot
  // overtake neighbours. Full front/rear passages remain, unlike fixed anchors.
  const basis={radialX:local([1,0,0]),radialZ:local([0,0,1]),vertical:local([0,1,0])};
  const items=drops.map((drop,index)=>{
    const orbit={...basis,center:local([-.11,.15,.08]),phase:index*2*Math.PI/drops.length+.65,
      radiusX:2.1,radiusZ:2.2,rise:1.2,speed:.045,wobble:drop.kind==='black'?.03:0};
    const item={...drop,orbit,bounds:[2.21,1.35]};
    return {...item,position:dropPoint(item,drop.motionIndex,0)};
  });
  const hero={name:'Large_Foreground_Resin_Drop',kind:'clear',hero:true,radius:.6,motionIndex:21,
    orbit:{...basis,center:local([-.1,-.5,2.35]),phase:0,radiusX:.05,radiusZ:0,rise:.05,speed:.12,wobble:0},bounds:[.15,.55]};
  items.push({...hero,position:dropPoint(hero,hero.motionIndex,0)});
  return items;
}

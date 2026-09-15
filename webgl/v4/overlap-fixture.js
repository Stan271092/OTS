// Appended to scene.mjs by the browser checker only. The real compositor and
// materials are exercised; no inspection hooks are shipped in the app.
window.__backdropProbe=()=>{
  stop();state.paused=true;hero.dataset.background='light';syncBackdrop();renderOptics();
  const gl=renderer.getContext(),pixel=new Uint8Array(4);gl.readPixels(2,2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  return [...pixel];
};
window.__overlapProbe=()=>{
  stop();state.paused=true;state.time=0;timeUniform.value=0;
  body.rotation.set(0,0,fixedView.roll);body.position.y=0;stage.rotation.set(0,fixedView.yaw,0);
  const resin=glass[0],satellite=drops.find(d=>d.drop.kind==='black');
  for(const child of [...body.children])if(child!==resin&&child!==satellite.mesh&&child!==powder)body.remove(child);
  glass.splice(1);drops.splice(0,drops.length,satellite);powder.count=0;
  scene.updateMatrixWorld(true);
  const inverse=body.matrixWorld.clone().invert(),pixels=()=>{
    const gl=renderer.getContext(),buffer=new Uint8Array(size.x*size.y*4);
    gl.readPixels(0,0,size.x,size.y,gl.RGBA,gl.UNSIGNED_BYTE,buffer);return buffer;
  };
  const results=[];
  for(const [x,y,z] of [[-.35,.15,-6],[.65,-.4,-6],[0,0,-12.5]]){
    satellite.mesh.position.copy(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorld).applyMatrix4(inverse));
    satellite.mesh.scale.setScalar(z===-6?.34:.8);
    // Isolated opaque silhouette, including antialiasing, supplies an independent mask.
    resin.visible=false;satellite.mesh.visible=true;powder.visible=false;
    renderer.setRenderTarget(null);renderer.autoClear=true;renderer.render(scene,camera);
    const mask=pixels();
    resin.visible=true;renderOptics();const withSphere=pixels();
    body.remove(satellite.mesh);drops.length=0;renderOptics();const withoutSphere=pixels();
    body.add(satellite.mesh);drops.push(satellite);
    let leaked=0,changed=0,maximum=0;
    for(let py=2;py<size.y-2;py++)for(let px=2;px<size.x-2;px++){
      const i=(py*size.x+px)*4;
      const delta=Math.max(...[0,1,2,3].map(c=>Math.abs(withSphere[i+c]-withoutSphere[i+c])));
      if(delta<=3)continue;
      changed++;
      let covered=false;
      for(let dy=-2;dy<=2&&!covered;dy++)for(let dx=-2;dx<=2;dx++)if(mask[((py+dy)*size.x+px+dx)*4+3]){covered=true;break;}
      if(!covered){leaked++;maximum=Math.max(maximum,delta);}
    }
    results.push({z,leaked,changed,maximum});
  }
  return results;
};

import * as THREE from '../vendor/three.module.js';

// Known CSS colors are decoded to linear radiance before transmission/reflection.
// The finished known-background image is encoded to sRGB once, without the
// inverse-ACES/high-radiance backdrop that crushed the glass-to-background contrast.
export function backdropRadiance(hex){
  return new THREE.Vector3(...new THREE.Color(hex).toArray());
}
export function createBackdrop(){
  const material=new THREE.ShaderMaterial({
    uniforms:{colorA:{value:backdropRadiance(0xeef1f3)},transparentBackdrop:{value:false}},
    vertexShader:'void main(){gl_Position=vec4(position.xy,1,1);}',
    fragmentShader:`uniform vec3 colorA;uniform bool transparentBackdrop;
      void main(){gl_FragColor=transparentBackdrop?vec4(0):vec4(colorA,1);}`,
    depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false,
  });
  const scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));
  return {scene,material};
}

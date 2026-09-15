import * as THREE from '../vendor/three.module.js';
import {flowGLSL,makePowder} from './resin-model.mjs';

// Tiny matte, irregular solids rather than smooth spheres. No specular lobes or
// hollow-ring alpha mask. Particle positions bend coherently; their silhouettes
// are not resampled through a discontinuous per-grain screen-space depth field.
export function createPowder(clusters,timeUniform,count=4600,occlusion) {
  const seeds=makePowder(count,clusters),geometry=new THREE.TetrahedronGeometry(1,0);
  const facets=new Float32Array(geometry.attributes.position.count*3);
  for(let i=0;i<facets.length;i+=3){const shade=[.72,1,.86,.62][Math.floor(i/9)%4];facets.set([shade,shade,shade],i);}
  geometry.setAttribute('color',new THREE.BufferAttribute(facets,3));
  const material=new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:true,transparent:true,opacity:.94,
    depthTest:false,depthWrite:false,toneMapped:false});
  material.onBeforeCompile=shader=>{
    shader.uniforms.flowTime=timeUniform;shader.uniforms.flowPhase={value:0};
    if(occlusion){
      shader.uniforms.powderOpaqueDepth=occlusion.depth;
      shader.uniforms.powderResolution=occlusion.resolution;
      shader.fragmentShader='uniform sampler2D powderOpaqueDepth;\nuniform vec2 powderResolution;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`
        #include <clipping_planes_fragment>
        if(texture2D(powderOpaqueDepth,gl_FragCoord.xy/powderResolution).r<gl_FragCoord.z-.000002)discard;
      `);
    }
    shader.vertexShader=flowGLSL+'attribute float grainPhase;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
      vec4 mvPosition=instanceMatrix*vec4(transformed,1.0);
      vec3 drift=.006*sin(vec3(.17,.195,.22)*flowTime+grainPhase+vec3(0,1,2));
      mvPosition.xyz=flowPoint(mvPosition.xyz+drift);
      mvPosition=modelViewMatrix*mvPosition;
      // A small coherent perspective shift supplies a depth cue without making
      // each powder grain a refractive lens. Artistic approximation, not ray tracing.
      mvPosition.xy*=1.0+.012*sin(grainPhase*.0003+flowTime*.06);
      gl_Position=projectionMatrix*mvPosition;
    `);
  };
  const mesh=new THREE.InstancedMesh(geometry,material,seeds.length);mesh.frustumCulled=false;
  mesh.name='Matte_Dispersed_Powder';
  const phases=new Float32Array(seeds.length),dummy=new THREE.Object3D();
  seeds.forEach((grain,i)=>{
    dummy.position.fromArray(grain.position);
    dummy.scale.set(grain.radius*1.2,grain.radius*(.85+(i%7)*.075),grain.radius*.9);
    const shade=.28+(i%11)*.065;mesh.setColorAt(i,new THREE.Color(shade,shade,shade));
    dummy.rotation.set(i*.7,i,grain.cluster);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);phases[i]=i*2.39996;
  });
  geometry.setAttribute('grainPhase',new THREE.InstancedBufferAttribute(phases,1));
  return mesh;
}

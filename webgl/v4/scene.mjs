import * as THREE from '../vendor/three.module.js';
import { flowGLSL, floatingPose, dropPoint, selectDrops, renderRatio } from './resin-model.mjs';
import { opticsGLSL } from './optics.mjs';
import { fixedView, separateDrops, projectLocal } from './layout.mjs';
import { createPowder } from './powder.mjs';
import { createBackdrop, backdropRadiance } from './backdrop.mjs';

const canvas=document.querySelector('#scene'), visual=document.querySelector('#visual');
const hero=document.querySelector('#hero'), loading=document.querySelector('#loading');
const status=document.querySelector('#status'), pause=document.querySelector('#pause');
const media=matchMedia('(prefers-reduced-motion: reduce)');
// Embed lifecycle: detect iframe context; fail-closed on hostVisible until parent signals.
const isEmbed=window.self!==window.top;
const state={ready:false,paused:false,reduced:media.matches,visible:true,
  lost:false,time:0,previous:null,quality:'eco',
  hostVisible:!isEmbed,cssHidden:false};
const timeUniform={value:0}, size=new THREE.Vector2(1,1);
const settings={eco:{grains:3000},detail:{grains:4600}};
const glass=[], drops=[], optics=[], flowMaterials=[];
let renderer,scene,camera,stage,body,powder,opaqueTarget,backTarget,targets,backMaterial;
let backdrop,copyScene,copyCamera,copyMaterial,environment,currentLayer,currentSourceDepth,frame=null,timer=null;
let extentX=2.5,extentY=2.6;
const active=()=>state.ready&&state.visible&&!document.hidden&&!state.lost&&state.hostVisible&&!state.cssHidden;
const moving=()=>!state.paused&&!state.reduced;

function stop(){clearTimeout(timer);cancelAnimationFrame(frame);timer=frame=null;state.previous=null;}
function requestRender(){if(active()&&frame===null&&timer===null)frame=requestAnimationFrame(render);}
function updateStatus(){
  pause.textContent=state.paused?'Включить движение':'Пауза';
  pause.setAttribute('aria-pressed',String(state.paused));
  pause.disabled=!state.ready||state.reduced||state.lost;
  status.textContent=state.lost?'WebGL остановлен':state.reduced?'Уменьшенное движение':
    state.paused?'Неподвижный образец':!state.visible||document.hidden?'Автопауза':
      `${state.quality==='eco'?'Бережный':'Детальнее'} · движение`;
}
function sync(){stop();updateStatus();requestRender();}
function render(now){
  frame=null;if(!active())return;
  if(moving()&&state.previous!==null)state.time+=Math.min((now-state.previous)/1000,.15);
  state.previous=now;
  timeUniform.value=state.time;
  const pose=floatingPose(state.time);
  body.rotation.set(pose.x,pose.y,pose.z);body.position.y=pose.lift;
  stage.rotation.set(0,fixedView.yaw,0);
  for(const {mesh,drop,index} of drops)mesh.position.fromArray(dropPoint(drop,index,state.time));
  renderOptics();
  if(moving())timer=setTimeout(()=>{timer=null;requestRender();},1000/20);
}

function deform(shader,phase){
  shader.uniforms.flowTime=timeUniform;shader.uniforms.flowPhase=phase;
  shader.vertexShader=flowGLSL+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',
    'vec3 objectNormal=flowNormal(position,normal);');
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
    'vec3 transformed=flowPoint(position);');
}

function studio(){
  // Reflection-only studio: softbox geometry is absent from the visible scene.
  const room=new THREE.Scene();room.background=new THREE.Color(.018,.021,.024);
  const add=(position,width,height,intensity,color=0xffffff)=>{
    const light=new THREE.Mesh(new THREE.PlaneGeometry(width,height),
      new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(intensity),side:THREE.DoubleSide}));
    light.position.fromArray(position);light.lookAt(0,0,0);room.add(light);
  };
  add([-3.8,5.2,4],2,4.5,3,0xfffcf8);
  add([3.5,2,.8],.7,4.8,2.8,0xe4f0ff);
  add([.3,4.5,-1.7],2.2,1.6,3.5);
  add([.3,-.7,4.5],1.5,1.5,.35);
  add([-2.5,-.4,-2.7],2,3,1.4,0xeafff6);
  const pmrem=new THREE.PMREMGenerator(renderer);
  environment=pmrem.fromScene(room,.055,.1,30);
  scene.environment=environment.texture;
  room.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});pmrem.dispose();
}

function gelMaterial(phase=0){
  const material=new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.045,metalness:0,ior:1.535,
    transparent:true,depthWrite:true,blending:THREE.NoBlending,clearcoat:.12,clearcoatRoughness:.05,envMapIntensity:.8});
  material.defines={...material.defines,USE_TRANSMISSION:''};
  const phaseUniform={value:phase};flowMaterials.push(phaseUniform);
  material.userData.phase=phaseUniform;
  material.onBeforeCompile=shader=>{
    deform(shader,phaseUniform);
    const uniforms={
      transmission:{value:1},thickness:{value:1},attenuationColor:{value:new THREE.Color(0xffffff)},attenuationDistance:{value:100},
      transmissionSamplerMap:{value:currentLayer||opaqueTarget.texture},transmissionSamplerSize:{value:size},
      opaqueDepth:{value:opaqueTarget.depthTexture},sourceDepth:{value:currentSourceDepth||opaqueTarget.depthTexture},backSurface:{value:backTarget.texture},
      inverseProjection:{value:camera.projectionMatrixInverse},volumeProjection:{value:camera.projectionMatrix},
    };
    optics.push(uniforms);Object.assign(shader.uniforms,uniforms);
    shader.fragmentShader=opticsGLSL+`
      uniform sampler2D opaqueDepth;
      uniform sampler2D sourceDepth;
      uniform sampler2D backSurface;
      uniform mat4 inverseProjection;
      uniform mat4 volumeProjection;
      vec2 projectPoint(vec3 p){vec4 q=volumeProjection*vec4(p,1);return q.xy/q.w*.5+.5;}
      vec3 viewPoint(vec2 uv,float depth){vec4 p=inverseProjection*vec4(uv*2.0-1.0,depth*2.0-1.0,1);return p.xyz/p.w;}
    `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <transmission_fragment>',`
      vec2 screenUv=gl_FragCoord.xy/transmissionSamplerSize;
      float frontOpaque=texture2D(opaqueDepth,screenUv).r;
      if(frontOpaque<gl_FragCoord.z-0.000002)discard;
      vec3 entry=-vViewPosition;
      vec3 V=isOrthographic ? vec3(0,0,1) : normalize(vViewPosition);
      vec3 ray=refract(-V,normal,1.0/material.ior);
      vec4 rear=texture2D(backSurface,screenUv);
      // Measured front/back separation, not a spherical chord. It remains a
      // screen-space approximation: no multiple internal reflection or ray tracing.
      float travel=rear.a>.5 ? clamp((rear.z-entry.z)/min(ray.z,-.15),0.0,3.5) : 0.0;
      for(int step=0;step<3;step++){
        vec2 candidate=projectPoint(entry+ray*travel);
        vec4 other=texture2D(backSurface,clamp(candidate,vec2(.001),vec2(.999)));
        if(other.a>.5 && other.z<entry.z){
          travel=mix(travel,clamp((other.z-entry.z)/min(ray.z,-.15),0.0,3.5),.6);
        }
      }
      // Sample inclusions at their depth along the internal ray, rather than
      // projecting every grain onto the rear boundary of the resin.
      vec2 uv=projectPoint(entry+ray*travel*.6);
      for(int step=0;step<2;step++){
        float d=texture2D(sourceDepth,clamp(uv,vec2(.001),vec2(.999))).r;
        if(d<.99999){
          vec3 inclusion=viewPoint(uv,d);
          float inside=inclusionDistance(inclusion.z,entry.z,ray.z,travel);
          uv=projectPoint(entry+ray*inside);
        }
      }
      vec2 texel=1.0/transmissionSamplerSize;
      uv=clamp(uv,texel,1.0-texel);
      if(texture2D(sourceDepth,uv).r<gl_FragCoord.z-.000002)uv=screenUv;
      vec4 transmitted=texture2D(transmissionSamplerMap,uv);
      float facing=clamp(dot(normal,V),0.0,1.0);
      float frontReflection=interfaceReflectance(facing,material.ior);
      float fresnel=surfaceReflectance(facing,material.ior);
      totalSpecular*=fresnel/max(frontReflection,.0001);
      float absorption=1.0-exp(-travel*.006);
      vec3 transmittance=exp(-vec3(.004,.003,.002)*travel);
      totalDiffuse=transmitted.rgb*transmittance*(1.0-fresnel);
      material.transmissionAlpha=transmitted.a+(1.0-transmitted.a)*(fresnel+absorption*(1.0-fresnel));
    `).replace('#include <opaque_fragment>',
      'gl_FragColor=vec4(outgoingLight,clamp(material.transmissionAlpha,0.0,1.0));');
  };
  return material;
}

function compositor(){
  const options={type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false,
    samples:Math.min(4,renderer.capabilities.maxSamples)};
  const layer=()=>{const target=new THREE.WebGLRenderTarget(1,1,options);target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);return target;};
  opaqueTarget=layer();targets=[layer(),layer()];
  // Position data must not be MSAA-resolved with background zeros at silhouettes.
  backTarget=new THREE.WebGLRenderTarget(1,1,{...options,samples:0,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  backMaterial=new THREE.ShaderMaterial({
    uniforms:{flowTime:timeUniform,flowPhase:{value:0}},side:THREE.BackSide,blending:THREE.NoBlending,
    vertexShader:flowGLSL+`varying vec3 backPosition;void main(){vec4 p=modelViewMatrix*vec4(flowPoint(position),1);backPosition=p.xyz;gl_Position=projectionMatrix*p;}`,
    fragmentShader:'varying vec3 backPosition;void main(){gl_FragColor=vec4(backPosition,1);}',
  });
  copyMaterial=new THREE.ShaderMaterial({
    uniforms:{image:{value:null},layerDepth:{value:null},present:{value:false},knownBackdrop:{value:true}},extensions:{fragDepth:true},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0,1);}',
    fragmentShader:`uniform sampler2D image;uniform sampler2D layerDepth;uniform bool present;uniform bool knownBackdrop;varying vec2 vUv;
      #include <tonemapping_pars_fragment>
      void main(){
        vec4 value=texture2D(image,vUv);
        gl_FragDepthEXT=present?1.0:texture2D(layerDepth,vUv).r;
        if(present){
          float alpha=clamp(value.a,0.0,1.0);
          vec3 straight=knownBackdrop?value.rgb:ACESFilmicToneMapping(value.rgb/max(alpha,.0001));
          gl_FragColor=vec4(straight,alpha);
          #include <colorspace_fragment>
          gl_FragColor.rgb*=alpha;
        }else gl_FragColor=value;
      }`,
    depthTest:true,depthWrite:true,depthFunc:THREE.AlwaysDepth,blending:THREE.NoBlending,toneMapped:false,
  });
  copyScene=new THREE.Scene();copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),copyMaterial));copyCamera=new THREE.Camera();
  backdrop=createBackdrop();syncBackdrop();
}

function syncBackdrop(){
  if(!backdrop)return;
  const mode=hero.dataset.background;
  backdrop.material.uniforms.transparentBackdrop.value=mode==='checker';
  copyMaterial.uniforms.knownBackdrop.value=mode!=='checker';
  backdrop.material.uniforms.colorA.value.copy(backdropRadiance(mode==='dark'?0x101c30:0xeef1f3));
}
const sortPosition=new THREE.Vector3();
function renderOptics(){
  for(const mesh of glass)mesh.visible=false;
  powder.visible=false;
  renderer.setRenderTarget(opaqueTarget);renderer.autoClear=true;renderer.render(scene,camera);
  const opaque=drops.filter(d=>d.drop.kind==='black').map(d=>d.mesh);
  for(const mesh of opaque)mesh.visible=false;
  scene.updateMatrixWorld(true);
  // Only already-drawn (rear) objects enter refraction. Foreground opaque color,
  // including its antialiased fringe, must never be in the sampled source.
  const depth=mesh=>sortPosition.setFromMatrixPosition(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse).z;
  const ordered=[...glass,...opaque].sort((a,b)=>depth(a)-depth(b));
  let previous=targets[0];renderer.setRenderTarget(previous);renderer.render(backdrop.scene,copyCamera);
  for(const mesh of ordered){
    if(opaque.includes(mesh)){
      renderer.setRenderTarget(previous);renderer.autoClear=false;
      mesh.visible=true;renderer.render(scene,camera);mesh.visible=false;continue;
    }
    const material=mesh.material;
    mesh.visible=true;mesh.material=backMaterial;
    backMaterial.uniforms.flowPhase.value=material.userData.phase.value;
    renderer.setRenderTarget(backTarget);renderer.autoClear=true;renderer.render(scene,camera);
    mesh.visible=false;mesh.material=material;
    const target=previous===targets[0]?targets[1]:targets[0];renderer.setRenderTarget(target);renderer.autoClear=false;
    copyMaterial.uniforms.image.value=previous.texture;copyMaterial.uniforms.layerDepth.value=previous.depthTexture;copyMaterial.uniforms.present.value=false;
    renderer.render(copyScene,copyCamera);
    currentLayer=previous.texture;currentSourceDepth=previous.depthTexture;
    for(const uniforms of optics){uniforms.transmissionSamplerMap.value=currentLayer;uniforms.sourceDepth.value=previous.depthTexture;}
    mesh.visible=true;renderer.render(scene,camera);mesh.visible=false;previous=target;
    // Paint internal grains after their host resin, before foreground clear drops.
    // depthWrite=false keeps grain discontinuities out of refraction depth.
    if(mesh===glass[0]){powder.visible=true;renderer.render(scene,camera);powder.visible=false;}
  }
  renderer.setRenderTarget(null);copyMaterial.uniforms.image.value=previous.texture;copyMaterial.uniforms.present.value=true;
  renderer.render(copyScene,copyCamera);renderer.autoClear=true;
  for(const mesh of [...glass,...opaque])mesh.visible=true;
}

function build(data){
  scene=new THREE.Scene();camera=new THREE.OrthographicCamera(-2.5,2.5,2.6,-2.6,.1,40);
  camera.position.fromArray(fixedView.direction).multiplyScalar(10);camera.lookAt(0,0,0);
  scene.add(new THREE.HemisphereLight(0xffffff,0x788690,2));
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(-3,5,4);scene.add(light);
  studio();compositor();
  stage=new THREE.Group();scene.add(stage);body=new THREE.Group();stage.add(body);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));geometry.setIndex(data.indices);geometry.computeBoundingSphere();geometry.boundingSphere.radius+=.3;
  const resin=new THREE.Mesh(geometry,gelMaterial());resin.name='Fused_Resin_From_Blender';body.add(resin);glass.push(resin);
  const sphereGeometry=new THREE.SphereGeometry(1,48,32);sphereGeometry.computeBoundingSphere();sphereGeometry.boundingSphere.radius=1.32;
  const black=new THREE.MeshPhysicalMaterial({color:0x030405,roughness:.14,metalness:0,clearcoat:.35,clearcoatRoughness:.08,envMapIntensity:1});
  const items=separateDrops(data,selectDrops(data));
  extentX=Math.max(...items.map(drop=>drop.bounds[0]+drop.radius*1.32))+.12;
  let bodyHeight=0;
  for(let i=0;i<data.positions.length;i+=3)bodyHeight=Math.max(bodyHeight,Math.abs(projectLocal(data.positions.slice(i,i+3))[1]));
  extentY=Math.max(bodyHeight+.3,...items.map(drop=>drop.bounds[1]+drop.radius*1.32))+.17;
  items.forEach(drop=>{
    const index=drop.motionIndex;
    const mesh=new THREE.Mesh(sphereGeometry,drop.kind==='clear'?gelMaterial(index*1.7):black);
    mesh.name=drop.name;mesh.scale.setScalar(drop.radius);mesh.position.fromArray(drop.position);body.add(mesh);
    drops.push({mesh,drop,index});if(drop.kind==='clear')glass.push(mesh);
  });
  powder=createPowder(data.clusters,timeUniform,settings.detail.grains,
    {depth:{value:opaqueTarget.depthTexture},resolution:{value:size}});
  powder.count=settings[state.quality].grains;body.add(powder);
}

function resize(){
  if(!renderer||!camera)return;
  const w=Math.max(1,visual.clientWidth),h=Math.max(1,visual.clientHeight);
  renderer.setPixelRatio(renderRatio(w,h,state.quality));renderer.setSize(w,h,false);renderer.getDrawingBufferSize(size);
  for(const target of [opaqueTarget,backTarget,...targets])target.setSize(size.x,size.y);
  const aspect=w/h,halfHeight=Math.max(extentY,extentX/aspect);
  camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;
  camera.top=halfHeight;camera.bottom=-halfHeight;camera.updateProjectionMatrix();
  requestRender();
}
function bind(){
  pause.addEventListener('click',()=>{state.paused=!state.paused;sync();});
  document.querySelectorAll('[data-bg]').forEach(button=>button.addEventListener('click',()=>{
    hero.dataset.background=button.dataset.bg;syncBackdrop();
    document.querySelectorAll('[data-bg]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));requestRender();
  }));
  document.querySelectorAll('[data-quality]').forEach(button=>button.addEventListener('click',()=>{
    state.quality=button.dataset.quality;
    document.querySelectorAll('[data-quality]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    if(powder)powder.count=settings[state.quality].grains;resize();updateStatus();
  }));
  document.addEventListener('visibilitychange',sync);media.addEventListener('change',e=>{state.reduced=e.matches;sync();});
  new ResizeObserver(resize).observe(visual);
  new IntersectionObserver(entries=>{state.visible=entries[0].isIntersecting;sync();}).observe(visual);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();state.lost=true;stop();updateStatus();loading.hidden=false;loading.textContent='Видеокарта остановила 3D. Обновите страницу после закрытия лишних вкладок.';});
  window.addEventListener('pagehide',stop);window.addEventListener('pageshow',()=>{if(state.ready)sync();});
  // Embed: detect body visibility:hidden (CSS hide from host) via MutationObserver.
  new MutationObserver(()=>{
    const s=document.body.style;
    state.cssHidden=s.visibility==='hidden'||s.display==='none';
    sync();
  }).observe(document.body,{attributes:true,attributeFilter:['style']});
  // Embed: accept host visibility messages from same-origin parent only.
  window.addEventListener('message',e=>{
    if(!isEmbed)return;
    if(e.source!==window.parent||e.origin!==location.origin)return;
    if(!e.data||typeof e.data!=='object')return;
    if(e.data.type==='ots-resin-visibility'&&typeof e.data.visible==='boolean'){
      state.hostVisible=e.data.visible;sync();
    }
  });
}

async function start(){
  bind();
  try{
    const response=await fetch('../resin-geometry.json');if(!response.ok)throw new Error('Geometry: '+response.status);
    const data=await response.json();
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
    if(!renderer.capabilities.isWebGL2)throw new Error('WebGL 2 is required for volume surfaces');
    renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
    build(data);resize();state.ready=true;loading.hidden=true;sync();
    // Embed: notify parent the scene is ready; parent then sends ots-resin-visibility.
    if(isEmbed)window.parent.postMessage({type:'ots-resin-ready'},location.origin);
  }catch(error){
    stop();loading.hidden=false;loading.textContent='Не удалось открыть 3D. Нужны локальный сервер и браузер с WebGL 2.';status.textContent='Ошибка загрузки';console.error(error);renderer?.dispose();
  }
}
start();

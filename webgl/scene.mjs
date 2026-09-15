import * as THREE from './vendor/three.module.js';
import { composition, surfacePoint, surfaceNormal, dropPosition, floatingPose, makePowder, powderPosition } from './gel-model.mjs';

const canvas = document.querySelector('#scene');
const visual = document.querySelector('#visual');
const hero = document.querySelector('#hero');
const loading = document.querySelector('#loading');
const status = document.querySelector('#status');
const pauseButton = document.querySelector('#pause');
const resetButton = document.querySelector('#reset');
const media = matchMedia('(prefers-reduced-motion: reduce)');
const state = {
  ready: false, paused: false, reduced: media.matches, visible: true,
  lost: false, quality: 'eco', time: 0, previous: null,
  yaw: 0, pitch: 0, pointer: null,
};
const settings = { eco: { dpr: 1.35, grains: 1320 }, detail: { dpr: 1.8, grains: 2160 } };
let renderer, scene, camera, stage, materialFrame, powder, environment, capsule;
let refractionTarget, layerTargets, copyScene, copyCamera, copyMaterial;
const opticalUniforms = [];
const deformingMeshes = [];
const sortingPosition = new THREE.Vector3();
const clearObjects = [];
let timer = null, frame = null;
let spheres = [], seeds = [];
const dummy = new THREE.Object3D();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const active = () => state.ready && state.visible && !document.hidden && !state.lost;
const moving = () => !state.paused && !state.reduced;

function stop() {
  clearTimeout(timer);
  cancelAnimationFrame(frame);
  timer = frame = null;
  state.previous = null;
}

function updateStatus() {
  pauseButton.textContent = state.paused ? 'Продолжить' : 'Пауза';
  pauseButton.setAttribute('aria-pressed', String(state.paused));
  pauseButton.disabled = !state.ready || state.reduced || state.lost;
  status.textContent = state.lost ? 'WebGL остановлен' : state.reduced ? 'Уменьшенное движение' :
    state.paused ? 'Пауза' : !state.visible || document.hidden ? 'Автопауза' :
      `${state.quality === 'eco' ? 'Бережный' : 'Детальнее'} · WebGL`;
}

function requestRender() {
  if (!active() || frame !== null || timer !== null) return;
  frame = requestAnimationFrame(render);
}

function syncPlayback() {
  stop();
  updateStatus();
  requestRender();
}

function render(now) {
  frame = null;
  if (!active()) return;
  if (moving() && state.previous !== null) state.time += Math.min((now - state.previous) / 1000, 0.1);
  state.previous = now;
  updateObjects(state.time);
  renderOptics();
  if (moving()) {
    // No continuous RAF while paused; at most 24 submissions per second.
    timer = setTimeout(() => {
      timer = null;
      requestRender();
    }, 1000 / 24);
  }
}

function studioEnvironment() {
  const surface = document.createElement('canvas');
  surface.width = 1024;
  surface.height = 512;
  const ctx = surface.getContext('2d');
  const base = ctx.createLinearGradient(0, 0, 0, 512);
  base.addColorStop(0, '#aebbc1');
  base.addColorStop(.52, '#303a41');
  base.addColorStop(1, '#65757e');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 512);
  // Large studio softboxes, not tiny point-light dots.
  ctx.filter = 'blur(9px)';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(170, 80, 80, 270);
  ctx.fillRect(730, 55, 160, 165);
  ctx.fillStyle = '#c9dbe5';
  ctx.fillRect(480, 360, 270, 28);
  ctx.filter = 'none';
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  environment = pmrem.fromEquirectangular(texture);
  scene.environment = environment.texture;
  texture.dispose();
  pmrem.dispose();
}

function gelMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: .06, metalness: 0, ior: 1.43,
    transparent: true, depthWrite: true, depthTest: true,
    blending: THREE.NoBlending, clearcoat: .08,
    clearcoatRoughness: .14, envMapIntensity: 1.1,
  });
  // Each gel replaces its screen region from the preceding layer. Normal alpha
  // blending here would retain the unrefracted black silhouette underneath it.
  material.defines = { ...material.defines, USE_TRANSMISSION: '' };
  material.onBeforeCompile = shader => {
    const uniforms = {
      transmission: { value: 1 }, thickness: { value: 2 },
      attenuationColor: { value: new THREE.Color(0xf6fcfa) },
      attenuationDistance: { value: 16 },
      transmissionSamplerMap: { value: currentLayer || refractionTarget.texture },
      transmissionSamplerSize: { value: refractionSize },
      opaqueDepth: { value: refractionTarget.depthTexture },
    };
    opticalUniforms.push(uniforms);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = 'uniform sampler2D opaqueDepth;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <transmission_fragment>', `
      vec2 screenUv = gl_FragCoord.xy / transmissionSamplerSize;
      // Keep a foreground black sphere in front of the gel, not refracted in it.
      if (texture2D(opaqueDepth, screenUv).r < gl_FragCoord.z - 0.000001) discard;
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
      vec3 ray = refract(-viewDir, worldNormal, material.ior > 0.0 ? 1.0/material.ior : 0.7);
      // Local sphere diameter times refracted incidence gives its chord length.
      // mesh scale supplies radius ONCE, including each differently sized drop.
      vec3 objectScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
      float chord = 2.0 * clamp(-dot(ray, worldNormal), 0.15, 1.0);
      vec3 exitPoint = vWorldPosition + ray * objectScale * chord;
      vec4 projected = projectionMatrix * viewMatrix * vec4(exitPoint, 1.0);
      vec2 uv = projected.xy / projected.w * 0.5 + 0.5;
      vec2 texel = 1.0 / transmissionSamplerSize;
      uv = clamp(uv, texel, 1.0-texel);
      if (texture2D(opaqueDepth, uv).r < gl_FragCoord.z - 0.000001) uv = screenUv;
      // Always use the full-resolution image; rough reflection is independent
      // of refraction. Mip-level blur was erasing powder and dark silhouettes.
      vec4 transmitted = texture2D(transmissionSamplerMap, uv);
      float facing = clamp(dot(worldNormal, viewDir), 0.0, 1.0);
      float fresnel = 0.031 + 0.969 * pow(1.0-facing, 5.0);
      vec3 transmittance = exp(-vec3(.008,.005,.003) * chord * objectScale);
      totalDiffuse = transmitted.rgb * transmittance * (1.0-fresnel);
      material.transmissionAlpha = transmitted.a + (1.0-transmitted.a) * (fresnel + .008);
    `).replace('#include <opaque_fragment>', `
      // All intermediate targets store LINEAR PREMULTIPLIED RGBA. Tone mapping
      // and conversion to browser premultiplied sRGB happen once, at presentation.
      gl_FragColor = vec4(outgoingLight, clamp(material.transmissionAlpha,0.0,1.0));
    `);
  };
  return material;
}

function createCompositor() {
  const options = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter, generateMipmaps: false,
    samples: renderer.capabilities.isWebGL2 ? 4 : 0 };
  refractionTarget = new THREE.WebGLRenderTarget(1, 1, options);
  refractionTarget.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  layerTargets = [0,1].map(() => {
    const target=new THREE.WebGLRenderTarget(1,1,options);
    target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    return target;
  });
  copyMaterial = new THREE.ShaderMaterial({
    uniforms: { image: { value: null }, layerDepth: { value: null }, present: { value: false } },
    extensions: { fragDepth: true },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `uniform sampler2D image; uniform sampler2D layerDepth; uniform bool present; varying vec2 vUv;
      #include <tonemapping_pars_fragment>
      void main(){
        vec4 value=texture2D(image,vUv);
        gl_FragDepthEXT=present ? 1.0 : texture2D(layerDepth,vUv).r;
        if(present){
          float alpha=clamp(value.a,0.0,1.0);
          vec3 straight=value.rgb/max(alpha,0.0001);
          straight=ACESFilmicToneMapping(straight);
          gl_FragColor=vec4(straight,alpha);
          #include <colorspace_fragment>
          gl_FragColor.rgb*=alpha;
        }else gl_FragColor=value;
      }`,
    depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, blending: THREE.NoBlending, toneMapped: false,
  });
  copyScene = new THREE.Scene();
  copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), copyMaterial));
  copyCamera = new THREE.Camera();
}

function renderOptics() {
  for (const mesh of clearObjects) mesh.visible = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(refractionTarget);
  renderer.render(scene, camera);
  const opaque = [powder, ...spheres.filter(item => item.drop.kind === 'black').map(item => item.mesh)];
  for (const mesh of opaque) mesh.visible = false;
  scene.updateMatrixWorld(true);
  // Sort by far extent, not crossing centers; per-pixel depth carried between
  // layers keeps the nearer wavy surface visible in intersecting screen regions.
  const farDepth = mesh => sortingPosition.setFromMatrixPosition(mesh.matrixWorld)
    .applyMatrix4(camera.matrixWorldInverse).z - mesh.scale.x * 1.15;
  const ordered = [...clearObjects].sort((a,b) => farDepth(a)-farDepth(b));
  let previous = refractionTarget;
  renderer.autoClear = false;
  for (let i=0;i<ordered.length;i++) {
    const target=layerTargets[i%2], mesh=ordered[i];
    renderer.setRenderTarget(target);
    copyMaterial.uniforms.image.value=previous.texture;
    copyMaterial.uniforms.layerDepth.value=previous.depthTexture;
    copyMaterial.uniforms.present.value=false;
    renderer.render(copyScene,copyCamera);
    // onBeforeRender also runs on first use before uniforms exist; onBeforeCompile
    // initializes with the current source, then this callback updates later frames.
    currentLayer=previous.texture;
    for (const uniforms of opticalUniforms) uniforms.transmissionSamplerMap.value=currentLayer;
    mesh.visible=true;
    renderer.render(scene,camera);
    mesh.visible=false;
    previous=target;
  }
  renderer.setRenderTarget(null);
  copyMaterial.uniforms.image.value=previous.texture;
  copyMaterial.uniforms.present.value=true;
  renderer.render(copyScene,copyCamera);
  renderer.autoClear=true;
  for (const mesh of [...clearObjects,...opaque]) mesh.visible=true;
}
let currentLayer;

const refractionSize = new THREE.Vector2(1, 1);
function buildScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, .1, 40);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xa9b9c3, 1.8));
  studioEnvironment();
  createCompositor();
  stage = new THREE.Group();
  scene.add(stage);
  materialFrame = new THREE.Group();
  stage.add(materialFrame);
  const geometry = new THREE.SphereGeometry(1, 88, 64);
  capsule = new THREE.Mesh(geometry, gelMaterial());
  capsule.scale.setScalar(composition.radius);
  deformingMeshes.push({ mesh: capsule, units: geometry.attributes.position.array.slice(), phase: 0 });
  capsule.name = 'Central_Viscous_Gel';
  materialFrame.add(capsule);
  clearObjects.push(capsule);
  const dropGeometry = new THREE.SphereGeometry(1, 48, 32);
  const black = new THREE.MeshPhysicalMaterial({
    color: 0x030405, roughness: .16, metalness: 0,
    clearcoat: .65, clearcoatRoughness: .13, envMapIntensity: 1.2,
  });
  spheres = composition.drops.map((drop, index) => {
    const shape = drop.kind === 'clear' ? dropGeometry.clone() : dropGeometry;
    const mesh = new THREE.Mesh(shape, drop.kind === 'clear' ? gelMaterial() : black);
    if (drop.kind === 'clear') deformingMeshes.push({ mesh, units: shape.attributes.position.array.slice(), phase: index * 1.7 + .5 });
    mesh.name = `${drop.kind}_drop_${index}`;
    mesh.scale.setScalar(drop.radius);
    materialFrame.add(mesh);
    if (drop.kind === 'clear') clearObjects.push(mesh);
    return { mesh, drop, index };
  });
  seeds = makePowder();
  powder = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .88, emissive: 0x363636, emissiveIntensity: .3 }),
    seeds.length,
  );
  powder.name = 'White_Powder_Independent_Grains';
  powder.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  powder.frustumCulled = false;
  materialFrame.add(powder);
  powder.count = settings[state.quality].grains;
  updateObjects(0);
}

function updateObjects(time) {
  const pose = floatingPose(time);
  materialFrame.rotation.set(pose.x, pose.y, pose.z);
  materialFrame.position.y = pose.lift;
  stage.rotation.set(state.pitch, state.yaw, 0);
  for (const { mesh, units, phase } of deformingMeshes) {
    const positions=mesh.geometry.attributes.position, normals=mesh.geometry.attributes.normal;
    for(let i=0;i<positions.count;i++) {
      const k=i*3,unit=[units[k],units[k+1],units[k+2]];
      positions.setXYZ(i,...surfacePoint(unit,time,phase));
      normals.setXYZ(i,...surfaceNormal(unit,time,phase));
    }
    positions.needsUpdate=normals.needsUpdate=true;
    if (!mesh.geometry.boundingSphere) mesh.geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),1.2);
    mesh.geometry.boundingSphere.radius=1.2;
  }
  for (const { mesh, drop, index } of spheres) mesh.position.fromArray(dropPosition(drop,index,time));
  for (let i = 0; i < powder.count; i++) {
    const item = seeds[i];
    dummy.position.fromArray(powderPosition(item, time));
    dummy.scale.setScalar(item.radius);
    dummy.rotation.set(item.index * .7 + time * .08, item.index, item.cluster + time * .06);
    dummy.updateMatrix();
    powder.setMatrixAt(i, dummy.matrix);
  }
  powder.instanceMatrix.needsUpdate = true;
}

function resize() {
  if (!renderer || !camera) return;
  const width = Math.max(1, visual.clientWidth), height = Math.max(1, visual.clientHeight);
  renderer.setPixelRatio(settings[state.quality].dpr);
  renderer.setSize(width, height, false);
  renderer.getDrawingBufferSize(refractionSize);
  refractionTarget.setSize(refractionSize.x, refractionSize.y);
  for (const target of layerTargets) target.setSize(refractionSize.x, refractionSize.y);
  camera.aspect = width / height;
  // Fit both dimensions rather than clipping the object on narrow phones.
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const distance = Math.max(2.18 / Math.tan(halfFov), 1.95 / (Math.tan(halfFov) * camera.aspect)) + 0.8;
  camera.position.set(0, 0.04, distance);
  camera.lookAt(0, 0.04, 0);
  camera.updateProjectionMatrix();
  requestRender();
}

function resetView() {
  state.yaw = state.pitch = 0;
  requestRender();
}

function bindUI() {
  pauseButton.addEventListener('click', () => { state.paused = !state.paused; syncPlayback(); });
  resetButton.addEventListener('click', resetView);
  document.querySelectorAll('[data-bg]').forEach(button => button.addEventListener('click', () => {
    hero.dataset.background = button.dataset.bg;
    document.querySelectorAll('[data-bg]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    requestRender();
  }));
  document.querySelectorAll('[data-quality]').forEach(button => button.addEventListener('click', () => {
    state.quality = button.dataset.quality;
    document.querySelectorAll('[data-quality]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    if (powder) powder.count = settings[state.quality].grains;
    resize();
    updateStatus();
  }));
  canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    state.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    const pointer = state.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    state.yaw = clamp(state.yaw + (event.clientX - pointer.x) * 0.008, -1.1, 1.1);
    state.pitch = clamp(state.pitch + (event.clientY - pointer.y) * 0.006, -0.6, 0.6);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    requestRender();
  });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(eventName, () => { state.pointer = null; });
  }
  canvas.addEventListener('keydown', event => {
    if (event.key === 'Home') { event.preventDefault(); resetView(); return; }
    const changes = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12] };
    if (!changes[event.key]) return;
    event.preventDefault();
    const [x, y] = changes[event.key];
    state.yaw = clamp(state.yaw + x, -1.1, 1.1);
    state.pitch = clamp(state.pitch + y, -0.6, 0.6);
    requestRender();
  });
  document.addEventListener('visibilitychange', syncPlayback);
  media.addEventListener('change', event => { state.reduced = event.matches; syncPlayback(); });
  new ResizeObserver(resize).observe(visual);
  new IntersectionObserver(entries => {
    state.visible = entries[0].isIntersecting;
    syncPlayback();
  }, { threshold: 0 }).observe(visual);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); state.lost = true; stop(); updateStatus();
    loading.hidden = false;
    loading.textContent = 'Видеокарта остановила 3D. Закройте лишние вкладки и обновите страницу.';
  });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', () => { if (state.ready) syncPlayback(); });
}

async function start() {
  bindUI();
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    buildScene();
    resize();
    state.ready = true;
    resetButton.disabled = false;
    loading.hidden = true;
    syncPlayback();
  } catch (error) {
    stop();
    loading.hidden = false;
    loading.textContent = '3D недоступен. Запустите serve.py и откройте локальный адрес в браузере с поддержкой WebGL.';
    status.textContent = 'Ошибка загрузки';
    console.error(error);
    renderer?.dispose();
  }
}
start();

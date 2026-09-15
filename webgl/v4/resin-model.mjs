// The CPU checks and GPU deformation use the same wave coefficients.
const waves = [
  { axis: 0, amplitude: .14, frequency: [0,1.7,.6], speed: .25, phase: 1 },
  { axis: 0, amplitude: .065, frequency: [0,0,2.1], speed: -.18, phase: .3 },
  { axis: 1, amplitude: .15, frequency: [-.5,0,1.4], speed: -.21, phase: .7 },
  { axis: 2, amplitude: .12, frequency: [1.5,.5,0], speed: .23, phase: .4 },
];
const angle = (wave,p,t,phase) => wave.frequency.reduce((s,f,i)=>s+f*p[i],0)+wave.speed*t+wave.phase*phase;
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

export function flowPoint(point,time,phase=0) {
  const result=[...point];
  // Each shear depends only on the other axes: composition preserves volume.
  for (const wave of waves) result[wave.axis]+=wave.amplitude*Math.sin(angle(wave,result,time,phase));
  return result;
}

export function flowNormal(point,normal,time,phase=0) {
  const columns=[[1,0,0],[0,1,0],[0,0,1]],q=[...point];
  for (const wave of waves) {
    const a=angle(wave,q,time,phase),slope=wave.amplitude*Math.cos(a);
    for(const column of columns)column[wave.axis]+=slope*wave.frequency.reduce((sum,v,i)=>sum+v*column[i],0);
    q[wave.axis]+=wave.amplitude*Math.sin(a);
  }
  const cofactors=[cross(columns[1],columns[2]),cross(columns[2],columns[0]),cross(columns[0],columns[1])];
  const n=[0,1,2].map(i=>normal.reduce((sum,v,j)=>sum+v*cofactors[j][i],0));
  const length=Math.hypot(...n);
  return n.map(v=>v/length);
}

const f = value => Number(value).toFixed(8);
const xyz='xyz';
export const flowGLSL = `
  uniform float flowTime;
  uniform float flowPhase;
  vec3 flowPoint(vec3 p) {
    vec3 q=p;
    ${waves.map(w=>`q.${xyz[w.axis]} += ${f(w.amplitude)} * sin(dot(vec3(${w.frequency.map(f).join(',')}),q)+${f(w.speed)}*flowTime+${f(w.phase)}*flowPhase);`).join('\n')}
    return q;
  }
  vec3 flowNormal(vec3 p, vec3 n) {
    vec3 dx=vec3(1,0,0),dy=vec3(0,1,0),dz=vec3(0,0,1),q=p;
    ${waves.map((w,index)=>`float a${index}=dot(vec3(${w.frequency.map(f).join(',')}),q)+${f(w.speed)}*flowTime+${f(w.phase)}*flowPhase;\nfloat s${index}=${f(w.amplitude)}*cos(a${index});\n`+
      [0,1,2].map(i=>`d${xyz[i]}.${xyz[w.axis]}+=s${index}*dot(vec3(${w.frequency.map(f).join(',')}),d${xyz[i]});`).join('\n')+
      `\nq.${xyz[w.axis]}+=${f(w.amplitude)}*sin(a${index});`).join('\n')}
    return normalize(n.x*cross(dy,dz)+n.y*cross(dz,dx)+n.z*cross(dx,dy));
  }
`;

export function floatingPose(time) {
  return { x:0, y:0, z:-.045, lift:.025*Math.sin(time*.16) };
}

export function selectDrops(data) {
  const keep=new Set([0,1,3,5,6,8,9]);
  return [
    ...data.spheres.flatMap((drop,index)=>keep.has(index) ?
      [{...drop,kind:'black',radius:drop.radius*.92*(index===3?1.22:1),motionIndex:index}] : []),
    ...data.beads.map((drop,index)=>({...drop,kind:'clear',radius:drop.radius*.92*(index===1?1.2:1),motionIndex:data.spheres.length+index})),
  ];
}

export function dropPoint(drop,index,time) {
  if(drop.orbit){
    const o=drop.orbit;
    const angle=o.phase+time*o.speed+o.wobble*Math.sin(time*.12+o.phase);
    const x=o.radiusX*Math.cos(angle),z=o.radiusZ*Math.sin(angle);
    const y=o.rise*Math.sin(angle);
    return o.center.map((v,i)=>v+x*o.radialX[i]+z*o.radialZ[i]+y*o.vertical[i]);
  }
  const phase=index*2.39996;
  const speed=drop.kind==='black' ? 2.1 : 1;
  const amplitude=drop.kind==='black' ? .035 : .024;
  return drop.position.map((v,axis)=>v+amplitude*Math.sin(time*(.11+axis*.02)*speed+phase+axis));
}

export function makePowder(count=4600,clusters) {
  let seed=782219;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return (seed+.5)/4294967296;};
  const gaussian=()=>Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random());
  // Y-up, with four clouds rather than a layer glued to the front surface.
  const centers=[[-.68,.68,.34],[.66,.62,.28],[-.52,-.55,.39],[.65,-.36,.33]];
  const kernels=centers.map(()=>Array.from({length:6},()=>[(random()-.5)*.23,(random()-.5)*.17,(random()-.5)*.1]));
  return Array.from({length:count},(_,index)=>{
    const cluster=index%4, center=centers[cluster],kernel=kernels[cluster][Math.floor(random()*6)];
    const spread=index%7===0 ? .1 : .052;
    const offset=[1,.8,.65].map(scale=>Math.max(-2.2,Math.min(2.2,gaussian()))*spread*scale);
    // Exported anchors were checked against the closed mesh with .07 clearance.
    // Bounded jitter densifies those clouds without spilling through narrow lobes.
    const anchors=clusters?.[cluster]?.grains;
    const anchor=anchors?.[Math.floor(index/4)%anchors.length];
    const size=random();
    return {index,cluster,radius:Math.floor(index/4)%6===0?.024+size*.009:Math.floor(index/4)%3===0?.012+size*.006:.006+size*.0028,
      position:anchor ? anchor.slice(0,3).map(v=>v+(random()-.5)*.024) :
        center.map((v,i)=>v+kernel[i]+offset[i])};
  });
}

export function powderPoint(grain,time) {
  const phase=grain.index*2.39996;
  const p=grain.position.map((v,i)=>v+.006*Math.sin(time*(.17+i*.025)+phase+i));
  return flowPoint(p,time);
}

export function renderRatio(width,height,quality) {
  const limit=quality==='detail' ? 1600000 : 800000;
  return Math.min(quality==='detail' ? 1.7 : 1.2,Math.sqrt(limit/Math.max(1,width*height)));
}

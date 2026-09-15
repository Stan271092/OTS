// Object-local, deterministic motion. All lengths are relative to the capsule.
export const composition = {
  radius: 1.21,
  drops: [
    { kind: 'clear', position: [-.95, .97, -.22], radius: .48 },
    { kind: 'clear', position: [.66, 1.19, -.42], radius: .38 },
    { kind: 'clear', position: [1.14, .43, .19], radius: .56 },
    { kind: 'clear', position: [-.78, -.99, .16], radius: .5 },
    { kind: 'clear', position: [.5, -1.23, -.23], radius: .36 },
    { kind: 'clear', position: [-1.3, -.14, -.36], radius: .3 },
    { kind: 'clear', position: [.07, 1.54, .18], radius: .19 },
    { kind: 'clear', position: [1.38, -.65, -.29], radius: .23 },
    { kind: 'black', position: [-.99, .57, .66], radius: .29 },
    { kind: 'black', position: [.73, -.82, .72], radius: .37 },
    { kind: 'black', position: [-.19, 1.25, .36], radius: .24 },
    { kind: 'black', position: [1.36, .96, -.12], radius: .21 },
    { kind: 'black', position: [-1.37, -.65, .2], radius: .2 },
    { kind: 'black', position: [-.1, -1.44, .19], radius: .25 },
    { kind: 'black', position: [.54, .27, -.77], radius: .14 },
    { kind: 'black', position: [-.29, -.21, .91], radius: .11 },
    { kind: 'black', position: [1.54, -.18, .16], radius: .1 },
  ].map(drop => ({ ...drop, radius: drop.radius * .85,
    position: drop.position.map(value => value * .97) })),
};

// Broad travelling lobes, not a uniform pulse or a high-frequency ripple.
function surfaceWave([x, y, z], time, phase) {
  const a = 2.4 * (.7*x + .5*y + .3*z) + time*.28 + phase;
  const b = 3.1 * (-.3*x + .6*y - .7*z) - time*.21 + phase*.63;
  const q = .03 * Math.sin(time*.24 + phase);
  return {
    radius: 1 + .07*Math.sin(a) + .045*Math.sin(b) + q*(x*x-y*y),
    gradient: [
      .168*.7*Math.cos(a) - .1395*.3*Math.cos(b) + 2*q*x,
      .168*.5*Math.cos(a) + .1395*.6*Math.cos(b) - 2*q*y,
      .168*.3*Math.cos(a) - .1395*.7*Math.cos(b),
    ],
  };
}

export function surfacePoint(unit, time, phase = 0) {
  const { radius } = surfaceWave(unit, time, phase);
  return unit.map(value => value * radius);
}

export function surfaceNormal(unit, time, phase = 0) {
  const { radius, gradient } = surfaceWave(unit, time, phase);
  const dot = gradient.reduce((sum,value,i) => sum + value*unit[i], 0);
  const normal = unit.map((value,i) => (radius+dot)*value-gradient[i]);
  const length = Math.hypot(...normal);
  return normal.map(value => value/length);
}

export function capsulePoint(unit, time) {
  return surfacePoint(unit, time).map(value => value * composition.radius);
}

export function dropPosition(drop, index, time) {
  const phase = index * 2.39996, speed = .13 + (index % 5) * .013;
  return [
    drop.position[0] + .045 * Math.sin(time * speed + phase),
    drop.position[1] + .052 * Math.sin(time * speed * .81 + phase * .7),
    drop.position[2] + .055 * Math.cos(time * speed * .67 + phase),
  ];
}

export function floatingPose(time) {
  return { x: .09 * Math.sin(time * .085), y: .1 + time * .028,
    z: -.12 + .04 * Math.sin(time * .071), lift: .045 * Math.sin(time * .19) };
}

export function makePowder(count = 2160) {
  let state = 187;
  const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
  const centers = [[-.43,.29,.52],[.26,-.14,.62],[-.31,-.47,.32],[.39,.46,.08]];
  return Array.from({ length: count }, (_, index) => {
    const cluster = index % centers.length, center = centers[cluster];
    const a = random() * Math.PI * 2, z = random() * 2 - 1;
    const r = Math.pow(random(), .55), radial = Math.sqrt(1 - z * z);
    return { cluster, index, radius: .004 + random() * .009,
      position: [center[0] + Math.cos(a) * radial * r * .24,
        center[1] + z * r * .15, center[2] + Math.sin(a) * radial * r * .18] };
  });
}

export function powderPosition(grain, time) {
  const p = grain.index * 2.39996, phase = grain.cluster * 1.7;
  return [grain.position[0] + .017 * Math.sin(time * .21 + phase) + .007 * Math.sin(time * .42 + p),
    grain.position[1] + .015 * Math.cos(time * .18 + phase) + .006 * Math.cos(time * .37 + p),
    grain.position[2] + .013 * Math.sin(time * .16 + phase + p)];
}

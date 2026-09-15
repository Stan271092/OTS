// Coordinates are object-local, so motion is independent of camera or root rotation.
export function spherePosition(base, index, time) {
  const phase = index * 1.79;
  const a = .105 + (index % 3) * .035;
  return [
    base[0] + Math.sin(time * (.32 + index * .013) + phase) * a,
    base[1] + Math.sin(time * (.27 + index * .009) + phase * .7) * a * 1.05,
    base[2] + Math.cos(time * .23 + phase) * a * .8
  ];
}

export function grainPosition(seed, index, cluster, time) {
  const phase = index * 2.39996;
  const speed = .55 + (index % 7) * .04;
  const amp = Math.min(.032, (seed[4] - seed[3] - .007) * .45);
  return [
    seed[0] + amp * (Math.sin(time * speed + phase) * .46 + Math.sin(time * .24 + cluster) * .48),
    seed[1] + amp * (Math.cos(time * speed * .76 + phase) * .45 + Math.cos(time * .31 + cluster * 2) * .43),
    seed[2] + amp * Math.sin(time * speed * .64 + phase * 1.13) * .72
  ];
}

export function resinPose(time) {
  return { x: .06 + Math.sin(time * .17) * .065,
    y: .18 + Math.sin(time * .20) * .23,
    z: Math.sin(time * .13) * .045,
    lift: Math.sin(time * .29) * .065 };
}

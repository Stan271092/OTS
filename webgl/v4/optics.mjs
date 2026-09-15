const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

// Incoherent two-interface slab approximation. Curved boundaries and total
// internal reflection need ray tracing; this only balances surface energy.
export function volumeReflectance(facing,ior) {
  const f0=((ior-1)/(ior+1))**2;
  const front=f0+(1-f0)*(1-clamp(facing,0,1))**5;
  return 2*front/(1+front);
}

// Art-directed rim, not a new physical Fresnel law: keep the edge translucent.
export function surfaceReflectance(facing,ior) {
  return volumeReflectance(facing,ior)*(.8-.04*(1-clamp(facing,0,1))**3);
}

export function inclusionDistance(depth,entry,rayZ,travel) {
  return clamp((depth-entry)/Math.min(rayZ,-.15),0,travel);
}

export const opticsGLSL=`
  float interfaceReflectance(float facing,float ior){
    float f0=pow((ior-1.0)/(ior+1.0),2.0);
    return f0+(1.0-f0)*pow(1.0-clamp(facing,0.0,1.0),5.0);
  }
  float volumeReflectance(float front){return 2.0*front/(1.0+front);}
  float surfaceReflectance(float facing,float ior){
    return volumeReflectance(interfaceReflectance(facing,ior))*(.8-.04*pow(1.0-clamp(facing,0.0,1.0),3.0));
  }
  float inclusionDistance(float depth,float entry,float rayZ,float travel){
    return clamp((depth-entry)/min(rayZ,-.15),0.0,travel);
  }
`;

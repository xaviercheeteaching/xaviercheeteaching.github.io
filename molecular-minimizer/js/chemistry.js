/* Unified browser chemistry facade for WP2-WP4.
   Uses custom RDKitFF WASM when available. It never fabricates chemistry results. */
export class ChemistryEngine {
  constructor(){ this.mod=null; this.ready=false; }
  async init(){
    if(!window.createRDKitFFModule) throw new Error('Custom RDKitFF WASM bundle is not installed yet.');
    this.mod=await window.createRDKitFFModule({locateFile:f=>`./rdkit-wasm/${f}`});
    this.ready=true; return this;
  }
  assert(){ if(!this.ready) throw new Error('Chemistry engine is not ready.'); }
  prepare3D(smiles,{seed=61453,forceField='MMFF94'}={}){
    this.assert(); return this.mod.prepare3D(smiles,seed,forceField);
  }
  inspect3D(smiles,{seed=61453}={}){
    this.assert(); return this.mod.inspect3D(smiles,seed);
  }
  probeForceFields(smiles,{seed=61453}={}){
    this.assert(); return this.mod.probeForceFields(smiles,seed);
  }
}
export const chemistry=new ChemistryEngine();

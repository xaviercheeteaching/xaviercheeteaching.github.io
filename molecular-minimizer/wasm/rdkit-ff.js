// Stable application-facing API. The UI talks only to RDKitFF, never directly
// to Embind symbols. This lets later work packages replace the WASM internals
// without changing the application.
export class RDKitFFClient {
  constructor() { this.module = null; }
  async init({ moduleFactory, locateFile } = {}) {
    if (!moduleFactory) throw new Error('RDKitFF moduleFactory is required');
    this.module = await moduleFactory({ locateFile });
    return this.version();
  }
  assertReady() { if (!this.module) throw new Error('RDKitFF is not initialized'); }
  call(name, ...args) {
    this.assertReady();
    try { return JSON.parse(this.module[name](...args)); }
    catch (e) { throw new Error(e?.message || `RDKitFF ${name} failed`); }
  }
  version() { return this.call('ffVersion'); }
  capabilities() { return this.call('ffCapabilities'); }
  prepare(smiles, { addHs = true } = {}) { return this.call('ffPrepare', smiles, addHs); }
  embed(smiles, { conformers = 1, seed = 61453 } = {}) { return this.call('ffEmbed', smiles, conformers, seed); }
  minimize(molblock, { forceField = 'MMFF94', maxIterations = 500 } = {}) { return this.call('ffMinimize', molblock, forceField, maxIterations); }
  conformers(smiles, { count = 20, forceField = 'MMFF94', maxIterations = 500, seed = 61453 } = {}) {
    return this.call('ffConformers', smiles, count, forceField, maxIterations, seed);
  }
}
export const RDKitFF = new RDKitFFClient();

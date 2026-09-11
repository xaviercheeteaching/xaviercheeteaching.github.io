// WP4 browser adapter. Expects the custom WASM module to expose probeForceField().
export class ForceFieldEngine {
  constructor(module) { this.module = module; }

  static supported() { return ['MMFF94', 'MMFF94s', 'UFF']; }

  probe(molBlock, requested = 'MMFF94', allowUFFFallback = true) {
    if (!ForceFieldEngine.supported().includes(requested)) {
      throw new Error(`Unsupported force field: ${requested}`);
    }
    if (!molBlock || !molBlock.includes('M  END')) {
      throw new Error('A valid MolBlock with coordinates is required.');
    }
    const r = this.module.probeForceField(molBlock, requested, allowUFFFallback);
    return {
      ok: Boolean(r.ok),
      parameterized: Boolean(r.parameterized),
      requested: r.requested,
      selected: r.selected,
      energy: Number(r.energy),
      units: 'kcal/mol',
      message: r.message,
      usedFallback: r.selected === 'UFF' && requested !== 'UFF'
    };
  }
}

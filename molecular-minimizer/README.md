# Molecular Minimizer

## Work-package status

- WP1 scientific contract: complete
- WP2 browser chemistry API: source complete; WASM compilation required
- WP3 ETKDGv3 3D embedding: C++ binding implemented; validation harness included
- WP4 force-field capability probing: MMFF94/MMFF94s/UFF bindings implemented; validation harness included
- WP5 minimization: not implemented yet

## Single project location
Everything for the minimizer lives under `/molecular-minimizer/`.

## Browser API
`js/chemistry.js` exposes one facade around the custom WASM module:

- `prepare3D(smiles, {seed, forceField})`
- `inspect3D(smiles, {seed})`
- `probeForceFields(smiles, {seed})`

## WP3 chemistry
The C++ binding parses and sanitizes SMILES, adds explicit hydrogens, then embeds one conformer with RDKit ETKDGv3 and a deterministic seed. `inspect3D()` returns RDKit's `is3D` flag and the coordinate Z-span so the browser validation page can reject a merely planar depiction.

## WP4 force fields
`probeForceFields()` reports parameter availability independently for MMFF94, MMFF94s and UFF. Unsupported parameterization must be surfaced to the user; it must never be silently treated as a valid force-field calculation.

## Build boundary
`rdkit-wasm/bindings.cpp` must be compiled against RDKit with Emscripten into `rdkit-wasm/RDKitFF.js` and `rdkit-wasm/RDKitFF.wasm`. Those generated binaries are intentionally not faked or represented as complete before compilation succeeds.

## Validation
After compilation, open `tests/validation.html`. It tests ethanol, aspirin, ibuprofen and caffeine for:
1. custom WASM engine load (WP2),
2. genuine ETKDGv3 3D coordinates (WP3), and
3. MMFF94/MMFF94s/UFF parameter availability reporting (WP4).

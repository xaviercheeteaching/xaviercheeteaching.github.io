# RDKitFF browser bridge — WP2

WP2 establishes a stable browser API between the Molecular Minimizer UI and a custom RDKit WebAssembly module.

## API

- `RDKitFF.version()` — bridge/API version
- `RDKitFF.capabilities()` — explicit feature flags
- `RDKitFF.prepare(smiles, {addHs})` — parse/sanitize SMILES, optionally add H, return MolBlock
- `RDKitFF.embed(...)` — reserved for WP3
- `RDKitFF.minimize(...)` — reserved for WP4/WP5
- `RDKitFF.conformers(...)` — reserved for WP6

Unsupported features deliberately throw rather than fabricate results.

## WP2 acceptance test

The browser smoke test passes when the compiled module loads and `prepare('CCO')` reports 3 heavy atoms and returns a MolBlock. Open `test.html` after building.

## Build

A compatible Emscripten + RDKit development environment is required:

```sh
mkdir -p build dist
cd build
emcmake cmake ..
cmake --build . -j2
cp rdkit_ff.js rdkit_ff.wasm ../dist/
```

The generated `dist/rdkit_ff.js` and `dist/rdkit_ff.wasm` are build artifacts and should be produced by the CI build environment. WP3 will extend the linked RDKit modules with DistGeom/ETKDG support.

# WP3 — Genuine 3D conformer generation

## Contract

`embed3D(smiles, randomSeed, addHs)` must:

1. Parse and sanitize SMILES with RDKit.
2. Add explicit hydrogens by default.
3. Generate one conformer with RDKit ETKDGv3.
4. Use a deterministic random seed.
5. Retry with `useRandomCoords=true` if the first embedding fails.
6. Return a 3D MOL block plus metadata.
7. Reject failed embeddings instead of silently displaying a 2D depiction.

## Browser return value

JSON string:

```json
{
  "ok": true,
  "method": "ETKDGv3",
  "randomSeed": 61453,
  "atomCount": 9,
  "conformerId": 0,
  "maxAbsZ": 1.234,
  "molblock": "..."
}
```

## Acceptance tests

Run with seed `61453` and explicit H enabled:

- ethanol: `CCO`
- aspirin: `CC(=O)Oc1ccccc1C(=O)O`
- ibuprofen: `CC(C)Cc1ccc(cc1)[C@@H](C)C(=O)O`
- caffeine: `Cn1c(=O)c2c(ncn2C)n(C)c1=O`

For each molecule:

- `ok === true`
- MOL block contains a conformer
- atom count includes explicit hydrogens
- coordinate dimensionality is 3D
- stereochemistry is preserved
- repeated calls with the same seed reproduce the same coordinates

`maxAbsZ` is included as a diagnostic against accidentally passing a generated 2D depiction downstream. Note that intrinsically planar molecules can legitimately be close to planar; final validation should therefore also rely on the RDKit conformer's 3D flag when the wrapper is integrated.

## Scope boundary

WP3 does **not** minimize the conformer or calculate an energy. Those belong to WP4/WP5. The output of WP3 is the starting geometry for force-field construction.

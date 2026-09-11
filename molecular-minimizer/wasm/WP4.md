# WP4 — Force-field engine

## Scope
Expose force-field parameterization and energy evaluation to browser JavaScript for an already embedded 3D RDKit molecule.

## Supported methods
- MMFF94 (default)
- MMFF94s
- UFF
- Optional automatic UFF fallback when MMFF cannot parameterize the molecule

## Browser contract
`probeForceField(molBlock, requested, allowUFFFallback)` returns:
- `ok`
- `parameterized`
- `requested`
- `selected`
- `energy` (force-field potential energy, kcal/mol)
- `message`

The JavaScript adapter additionally reports `usedFallback` and `units`.

## Scientific behavior
1. The input must already contain a conformer; 3D embedding belongs to WP3.
2. MMFF parameter completeness is checked before force-field construction.
3. UFF parameter completeness is checked before force-field construction.
4. A missing MMFF parameter must never silently produce an MMFF result.
5. UFF fallback must be explicitly reported to the UI.
6. Energy is labelled force-field potential energy (kcal/mol), not free energy.

## Acceptance tests
- Ethanol: MMFF94 parameterizes and returns a finite energy.
- Aspirin: MMFF94 parameterizes and returns a finite energy.
- MMFF94s: selected method is reported as MMFF94s.
- Explicit UFF: selected method is UFF.
- MMFF-incompatible molecule with fallback disabled: parameterized=false and no false MMFF result.
- Same incompatible molecule with fallback enabled and valid UFF params: selected=UFF and usedFallback=true.
- Missing conformer / malformed MolBlock: returns a clear error state.

## Dependency
This code must be compiled into the custom RDKit WebAssembly target with RDKit ForceField, ForceFieldHelpers/MMFF and ForceFieldHelpers/UFF enabled. It cannot be executed by stock MinimalLib until those bindings are present.

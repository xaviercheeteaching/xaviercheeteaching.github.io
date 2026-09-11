#!/usr/bin/env bash
set -euo pipefail
: "${RDKIT_SRC:?Set RDKIT_SRC to the RDKit source directory}"
: "${RDKIT_BUILD:?Set RDKIT_BUILD to the Emscripten RDKit build directory}"
em++ bindings.cpp -O3 --bind -std=c++17 \
  -I"$RDKIT_SRC/Code" -I"$RDKIT_SRC/External" \
  -L"$RDKIT_BUILD/lib" \
  -lRDKitDistGeomHelpers -lRDKitForceFieldHelpers -lRDKitForceField \
  -lRDKitSmilesParse -lRDKitFileParsers -lRDKitGraphMol -lRDKitRDGeneral \
  -s MODULARIZE=1 -s EXPORT_NAME=initRDKitFF -s ALLOW_MEMORY_GROWTH=1 \
  -s ENVIRONMENT=web -s ASSERTIONS=1 \
  -o RDKitFF.js

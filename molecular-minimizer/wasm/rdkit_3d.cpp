// WP3: browser-facing RDKit 3D conformer generation wrapper.
// Compiled with Emscripten/Embind against RDKit C++.
#include <GraphMol/SmilesParse/SmilesParse.h>
#include <GraphMol/AddHs.h>
#include <GraphMol/FileParsers/MolWriters.h>
#include <GraphMol/DistGeomHelpers/Embedder.h>
#include <GraphMol/Conformer.h>
#include <emscripten/bind.h>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <cmath>

namespace {
std::string jsonEscape(const std::string &s) {
  std::ostringstream o;
  for (char c : s) {
    switch (c) {
      case '\\': o << "\\\\"; break;
      case '"': o << "\\\""; break;
      case '\n': o << "\\n"; break;
      case '\r': o << "\\r"; break;
      case '\t': o << "\\t"; break;
      default: o << c;
    }
  }
  return o.str();
}

std::string embed3D(const std::string &smiles, int randomSeed, bool addHs) {
  try {
    std::unique_ptr<RDKit::ROMol> parsed(RDKit::SmilesToMol(smiles));
    if (!parsed) throw std::runtime_error("SMILES could not be parsed");

    std::unique_ptr<RDKit::ROMol> mol;
    if (addHs) mol.reset(RDKit::MolOps::addHs(*parsed));
    else mol.reset(new RDKit::ROMol(*parsed));

    auto params = RDKit::DGeomHelpers::ETKDGv3;
    params.randomSeed = randomSeed;
    params.useRandomCoords = false;
    int confId = RDKit::DGeomHelpers::EmbedMolecule(*mol, params);

    // Robust fallback recommended for molecules where distance-geometry
    // initialization fails: retry ETKDGv3 from random coordinates.
    if (confId < 0) {
      params.useRandomCoords = true;
      confId = RDKit::DGeomHelpers::EmbedMolecule(*mol, params);
    }
    if (confId < 0) throw std::runtime_error("ETKDGv3 embedding failed");

    const auto &conf = mol->getConformer(confId);
    bool nonPlanar = false;
    double maxAbsZ = 0.0;
    for (unsigned int i = 0; i < mol->getNumAtoms(); ++i) {
      const auto &p = conf.getAtomPos(i);
      maxAbsZ = std::max(maxAbsZ, std::fabs(p.z));
      if (std::fabs(p.z) > 1e-4) nonPlanar = true;
    }
    if (!nonPlanar && mol->getNumAtoms() > 3) {
      throw std::runtime_error("Embedding returned planar coordinates; 3D validation failed");
    }

    const std::string block = RDKit::MolToMolBlock(*mol, true, confId, false, true);
    std::ostringstream out;
    out << "{\"ok\":true,\"method\":\"ETKDGv3\",\"randomSeed\":" << randomSeed
        << ",\"atomCount\":" << mol->getNumAtoms()
        << ",\"conformerId\":" << confId
        << ",\"maxAbsZ\":" << maxAbsZ
        << ",\"molblock\":\"" << jsonEscape(block) << "\"}";
    return out.str();
  } catch (const std::exception &e) {
    return std::string("{\"ok\":false,\"error\":\"") + jsonEscape(e.what()) + "\"}";
  }
}
}

EMSCRIPTEN_BINDINGS(rdkit_3d_module) {
  emscripten::function("embed3D", &embed3D);
}

#include <emscripten/bind.h>
#include <GraphMol/SmilesParse/SmilesParse.h>
#include <GraphMol/MolOps.h>
#include <GraphMol/DistGeomHelpers/Embedder.h>
#include <GraphMol/ForceFieldHelpers/MMFF/MMFF.h>
#include <GraphMol/ForceFieldHelpers/UFF/UFF.h>
#include <GraphMol/FileParsers/MolWriters.h>
#include <GraphMol/Descriptors/MolDescriptors.h>
#include <ForceField/ForceField.h>
#include <memory>
#include <sstream>
#include <stdexcept>

using namespace emscripten;

static std::unique_ptr<RDKit::RWMol> parseAndAddHs(const std::string &smiles) {
  std::unique_ptr<RDKit::RWMol> mol(RDKit::SmilesToMol(smiles));
  if (!mol) throw std::runtime_error("Invalid SMILES");
  RDKit::MolOps::sanitizeMol(*mol);
  std::unique_ptr<RDKit::ROMol> withHs(RDKit::MolOps::addHs(*mol));
  return std::make_unique<RDKit::RWMol>(*withHs);
}

static val parameterization(RDKit::ROMol &mol, const std::string &ff) {
  val out = val::object();
  out.set("forceField", ff);
  if (ff == "UFF") {
    bool ok = RDKit::UFF::hasAllMoleculeParams(mol);
    out.set("supported", ok);
    out.set("message", ok ? "UFF parameters available" : "UFF parameters missing for one or more atoms");
    return out;
  }
  bool ok = RDKit::MMFF::hasAllMoleculeParams(mol);
  out.set("supported", ok);
  out.set("message", ok ? "MMFF parameters available" : "MMFF parameters missing for one or more atoms");
  return out;
}

static val prepare3D(const std::string &smiles, int seed, const std::string &ff) {
  auto mol = parseAndAddHs(smiles);
  RDKit::DGeomHelpers::EmbedParameters params(RDKit::DGeomHelpers::ETKDGv3);
  params.randomSeed = seed;
  params.useRandomCoords = false;
  params.enforceChirality = true;
  int cid = RDKit::DGeomHelpers::EmbedMolecule(*mol, params);
  if (cid < 0) throw std::runtime_error("ETKDGv3 failed to generate a 3D conformer");

  auto p = parameterization(*mol, ff);
  val out = val::object();
  out.set("smiles", smiles);
  out.set("method", "ETKDGv3");
  out.set("seed", seed);
  out.set("conformerId", cid);
  out.set("atoms", static_cast<int>(mol->getNumAtoms()));
  out.set("heavyAtoms", static_cast<int>(mol->getNumHeavyAtoms()));
  out.set("molblock", RDKit::MolToMolBlock(*mol, true, cid));
  out.set("parameterization", p);
  return out;
}

static val probeForceFields(const std::string &smiles, int seed) {
  auto mol = parseAndAddHs(smiles);
  RDKit::DGeomHelpers::EmbedParameters params(RDKit::DGeomHelpers::ETKDGv3);
  params.randomSeed = seed;
  int cid = RDKit::DGeomHelpers::EmbedMolecule(*mol, params);
  if (cid < 0) throw std::runtime_error("ETKDGv3 failed to generate a 3D conformer");
  val out = val::object();
  out.set("MMFF94", parameterization(*mol, "MMFF94"));
  out.set("MMFF94s", parameterization(*mol, "MMFF94s"));
  out.set("UFF", parameterization(*mol, "UFF"));
  return out;
}

static val inspect3D(const std::string &smiles, int seed) {
  auto mol = parseAndAddHs(smiles);
  RDKit::DGeomHelpers::EmbedParameters params(RDKit::DGeomHelpers::ETKDGv3);
  params.randomSeed = seed;
  int cid = RDKit::DGeomHelpers::EmbedMolecule(*mol, params);
  if (cid < 0) throw std::runtime_error("ETKDGv3 embedding failed");
  const auto &conf = mol->getConformer(cid);
  double minZ = 1e100, maxZ = -1e100;
  for (unsigned i=0;i<mol->getNumAtoms();++i) {
    double z=conf.getAtomPos(i).z; minZ=std::min(minZ,z); maxZ=std::max(maxZ,z);
  }
  val out=val::object();
  out.set("is3D", conf.is3D());
  out.set("zSpan", maxZ-minZ);
  out.set("atomCount", static_cast<int>(mol->getNumAtoms()));
  out.set("molblock", RDKit::MolToMolBlock(*mol,true,cid));
  return out;
}

EMSCRIPTEN_BINDINGS(rdkit_ff) {
  function("prepare3D", &prepare3D);
  function("probeForceFields", &probeForceFields);
  function("inspect3D", &inspect3D);
}

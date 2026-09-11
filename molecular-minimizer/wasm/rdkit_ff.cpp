// Browser-facing RDKit force-field bridge for Molecular Minimizer.
// Compiled with Emscripten/Embind. WP2 establishes a stable JS API;
// WP3-WP6 fill in embedding, force-field and conformer implementations.
#include <emscripten/bind.h>
#include <GraphMol/GraphMol.h>
#include <GraphMol/SmilesParse/SmilesParse.h>
#include <GraphMol/FileParsers/MolWriters.h>
#include <GraphMol/MolOps.h>
#include <memory>
#include <sstream>
#include <stdexcept>

using namespace emscripten;

static std::string jsonEscape(const std::string &s) {
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

static std::unique_ptr<RDKit::RWMol> parse(const std::string &smiles) {
  std::unique_ptr<RDKit::RWMol> mol(RDKit::SmilesToMol(smiles));
  if (!mol) throw std::runtime_error("Invalid SMILES");
  return mol;
}

std::string ffVersion() {
  return R"({"api":"RDKitFF","apiVersion":"0.1.0","stage":"WP2"})";
}

std::string ffCapabilities() {
  return R"({"parse":true,"sanitize":true,"addHs":true,"molblock":true,"embed3D":false,"mmff94":false,"mmff94s":false,"uff":false,"minimize":false,"multiConformer":false})";
}

std::string ffPrepare(const std::string &smiles, bool addHs) {
  auto mol = parse(smiles);
  unsigned int heavy = mol->getNumHeavyAtoms();
  unsigned int before = mol->getNumAtoms();
  std::unique_ptr<RDKit::ROMol> withHs;
  const RDKit::ROMol *out = mol.get();
  if (addHs) {
    withHs.reset(RDKit::MolOps::addHs(*mol));
    out = withHs.get();
  }
  std::ostringstream j;
  j << "{\"ok\":true,\"atoms\":" << out->getNumAtoms()
    << ",\"heavyAtoms\":" << heavy
    << ",\"hydrogensAdded\":" << (out->getNumAtoms() - before)
    << ",\"molblock\":\"" << jsonEscape(RDKit::MolToMolBlock(*out)) << "\"}";
  return j.str();
}

std::string ffEmbed(const std::string &, int, int) {
  throw std::runtime_error("embed() is reserved for WP3: ETKDGv3 support is not compiled yet");
}
std::string ffMinimize(const std::string &, const std::string &, int) {
  throw std::runtime_error("minimize() is reserved for WP4/WP5: force-field support is not compiled yet");
}
std::string ffConformers(const std::string &, int, const std::string &, int, int) {
  throw std::runtime_error("conformers() is reserved for WP6: conformer search is not compiled yet");
}

EMSCRIPTEN_BINDINGS(rdkit_ff) {
  function("ffVersion", &ffVersion);
  function("ffCapabilities", &ffCapabilities);
  function("ffPrepare", &ffPrepare);
  function("ffEmbed", &ffEmbed);
  function("ffMinimize", &ffMinimize);
  function("ffConformers", &ffConformers);
}

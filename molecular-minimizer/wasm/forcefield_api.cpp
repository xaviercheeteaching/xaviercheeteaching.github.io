// WP4: force-field API for the browser RDKit-WASM build.
// This translation unit is intended to be compiled with Emscripten/Embind
// against a full RDKit build containing ForceFieldHelpers.
#include <GraphMol/RDKitBase.h>
#include <GraphMol/MolOps.h>
#include <GraphMol/SmilesParse/SmilesParse.h>
#include <GraphMol/ForceFieldHelpers/MMFF/MMFF.h>
#include <GraphMol/ForceFieldHelpers/UFF/UFF.h>
#include <ForceField/ForceField.h>
#include <emscripten/bind.h>
#include <memory>
#include <stdexcept>
#include <string>

using namespace RDKit;

struct FFProbeResult {
  bool ok = false;
  bool parameterized = false;
  std::string requested;
  std::string selected;
  std::string message;
  double energy = 0.0;
};

static std::unique_ptr<ROMol> parseMolBlock(const std::string &block) {
  auto *raw = MolBlockToMol(block, true, false);
  if (!raw) throw std::runtime_error("Unable to parse 3D MolBlock");
  return std::unique_ptr<ROMol>(raw);
}

FFProbeResult probeForceField(const std::string &molBlock,
                              const std::string &requested,
                              bool allowUFFFallback) {
  FFProbeResult out;
  out.requested = requested;
  try {
    auto mol = parseMolBlock(molBlock);
    if (mol->getNumConformers() == 0) throw std::runtime_error("A 3D conformer is required");

    if (requested == "MMFF94" || requested == "MMFF94s") {
      const auto variant = requested;
      MMFF::MMFFMolProperties props(*mol, variant);
      if (props.isValid()) {
        std::unique_ptr<ForceFields::ForceField> ff(MMFF::constructForceField(*mol, &props));
        if (!ff) throw std::runtime_error("MMFF force field construction failed");
        ff->initialize();
        out.ok = out.parameterized = true;
        out.selected = variant;
        out.energy = ff->calcEnergy();
        out.message = "Complete MMFF parameterization";
        return out;
      }
      if (!allowUFFFallback) {
        out.selected = variant;
        out.message = "MMFF parameters are unavailable for one or more atoms";
        return out;
      }
    }

    if (requested == "UFF" || allowUFFFallback) {
      if (!UFF::hasAllMoleculeParams(*mol)) {
        out.selected = "UFF";
        out.message = "UFF parameters are unavailable for one or more atoms";
        return out;
      }
      std::unique_ptr<ForceFields::ForceField> ff(UFF::constructForceField(*mol));
      if (!ff) throw std::runtime_error("UFF force field construction failed");
      ff->initialize();
      out.ok = out.parameterized = true;
      out.selected = "UFF";
      out.energy = ff->calcEnergy();
      out.message = requested == "UFF" ? "Complete UFF parameterization" : "MMFF unavailable; using UFF fallback";
      return out;
    }
    out.message = "Unknown force field: " + requested;
  } catch (const std::exception &e) {
    out.message = e.what();
  }
  return out;
}

EMSCRIPTEN_BINDINGS(rdkit_forcefield_api) {
  emscripten::value_object<FFProbeResult>("FFProbeResult")
      .field("ok", &FFProbeResult::ok)
      .field("parameterized", &FFProbeResult::parameterized)
      .field("requested", &FFProbeResult::requested)
      .field("selected", &FFProbeResult::selected)
      .field("message", &FFProbeResult::message)
      .field("energy", &FFProbeResult::energy);
  emscripten::function("probeForceField", &probeForceField);
}

#include <emscripten/bind.h>
#include <GraphMol/SmilesParse/SmilesParse.h>
#include <GraphMol/MolOps.h>
#include <GraphMol/DistGeomHelpers/Embedder.h>
#include <GraphMol/ForceFieldHelpers/MMFF/MMFF.h>
#include <GraphMol/ForceFieldHelpers/UFF/UFF.h>
#include <GraphMol/FileParsers/MolWriters.h>
#include <ForceField/ForceField.h>
#include <memory>
#include <stdexcept>
using namespace emscripten;

static std::unique_ptr<RDKit::RWMol> prep(const std::string&s){std::unique_ptr<RDKit::RWMol> m(RDKit::SmilesToMol(s));if(!m)throw std::runtime_error("Invalid SMILES");RDKit::MolOps::sanitizeMol(*m);std::unique_ptr<RDKit::ROMol> h(RDKit::MolOps::addHs(*m));return std::make_unique<RDKit::RWMol>(*h);}
static int embed(RDKit::RWMol&m,int seed){RDKit::DGeomHelpers::EmbedParameters p(RDKit::DGeomHelpers::ETKDGv3);p.randomSeed=seed;p.enforceChirality=true;int cid=RDKit::DGeomHelpers::EmbedMolecule(m,p);if(cid<0)throw std::runtime_error("ETKDGv3 embedding failed");return cid;}
static val minimize(const std::string&s,const std::string&requested,int maxIters,int seed){auto m=prep(s);int cid=embed(*m,seed);std::unique_ptr<ForceFields::ForceField> ff;std::unique_ptr<RDKit::MMFF::MMFFMolProperties> props;std::string used=requested;bool fallback=false;if(requested=="MMFF94"||requested=="MMFF94s"){if(RDKit::MMFF::hasAllMoleculeParams(*m)){props=std::make_unique<RDKit::MMFF::MMFFMolProperties>(*m,requested);ff.reset(RDKit::MMFF::constructForceField(*m,props.get(),100.0,cid));}if(!ff){used="UFF";fallback=true;}}if(used=="UFF"){if(!RDKit::UFF::hasAllMoleculeParams(*m))throw std::runtime_error("No complete MMFF/UFF parameterization for this molecule");ff.reset(RDKit::UFF::constructForceField(*m,10.0,cid));}if(!ff)throw std::runtime_error("Force-field construction failed");ff->initialize();double e0=ff->calcEnergy();int code=ff->minimize(maxIters);double e1=ff->calcEnergy();val o=val::object();o.set("ok",true);o.set("requestedForceField",requested);o.set("forceField",used);o.set("fallback",fallback);o.set("embedding","ETKDGv3");o.set("seed",seed);o.set("atoms",(int)m->getNumAtoms());o.set("heavyAtoms",(int)m->getNumHeavyAtoms());o.set("initialEnergy",e0);o.set("finalEnergy",e1);o.set("deltaEnergy",e1-e0);o.set("converged",code==0);o.set("statusCode",code);o.set("maxIterations",maxIters);o.set("molblock",RDKit::MolToMolBlock(*m,true,cid));return o;}
static val inspect3D(const std::string&s,int seed){auto m=prep(s);int cid=embed(*m,seed);const auto&c=m->getConformer(cid);double lo=1e100,hi=-1e100;for(unsigned i=0;i<m->getNumAtoms();++i){double z=c.getAtomPos(i).z;lo=std::min(lo,z);hi=std::max(hi,z);}val o=val::object();o.set("is3D",c.is3D());o.set("zSpan",hi-lo);o.set("atoms",(int)m->getNumAtoms());o.set("molblock",RDKit::MolToMolBlock(*m,true,cid));return o;}
EMSCRIPTEN_BINDINGS(rdkit_ff){function("minimize",&minimize);function("inspect3D",&inspect3D);}

cmake_minimum_required(VERSION 3.18)
project(rdkit_ff_wasm LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Build with emcmake cmake")
endif()
find_package(RDKit REQUIRED)
add_executable(rdkit_ff rdkit_ff.cpp)
target_include_directories(rdkit_ff PRIVATE ${RDKIT_INCLUDE_DIR})
target_link_libraries(rdkit_ff PRIVATE RDKit::SmilesParse RDKit::FileParsers RDKit::GraphMol)
set_target_properties(rdkit_ff PROPERTIES OUTPUT_NAME "rdkit_ff" SUFFIX ".js")
target_link_options(rdkit_ff PRIVATE
  "--bind"
  "-sMODULARIZE=1"
  "-sEXPORT_ES6=1"
  "-sENVIRONMENT=web,worker"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sFILESYSTEM=0"
  "-sASSERTIONS=1"
  "-sEXPORT_NAME=createRDKitFFModule"
)

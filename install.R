# Core tidyverse packages
install.packages("tidyverse")   # includes ggplot2, dplyr, tidyr, readr, tibble
install.packages("here")

# Visualization extensions
install.packages("ggrepel")
install.packages("patchwork")
install.packages("ggnewscale")
install.packages("Cairo")

# Data manipulation
install.packages("data.table")

# Statistics
install.packages("pwr")
install.packages("survival")

# Scripting utilities
install.packages("argparse")
install.packages("remotes")

# Bioconductor packages
if (!requireNamespace("BiocManager", quietly = TRUE))
    install.packages("BiocManager")
BiocManager::install("Biobase")
BiocManager::install("DESeq2")
BiocManager::install("limma")

# Install IRkernel for Jupyter
install.packages("IRkernel")
IRkernel::installspec(user = FALSE)

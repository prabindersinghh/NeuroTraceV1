#!/usr/bin/env bash
# Fetch the training datasets. Run from the repository root.
#
#   ./scripts/download_datasets.sh            # everything openly downloadable
#   ./scripts/download_datasets.sh librispeech
#
# THREE OF THESE CANNOT BE SCRIPTED. TORGO, UASpeech and mPower need a human to request
# access and agree to a licence, and that takes days to weeks. Start those first — this
# script tells you exactly what to ask for and where to put what arrives.
#
# Nothing here is required to run the training pipelines. Every script falls back to
# synthetic fixtures and marks its output "synthetic": true, so the code path is exercised
# before any real data exists. Those numbers are meaningless and say so.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW="$ROOT/data/raw"
mkdir -p "$RAW"

log()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

# --------------------------------------------------------------------------- open
librispeech() {
  log "LibriSpeech train-clean-100 (healthy speech controls)"
  note "Licence: CC BY 4.0 · ~6 GB"
  local dir="$RAW/librispeech"
  mkdir -p "$dir"
  if [ -d "$dir/LibriSpeech" ]; then note "already present, skipping"; return; fi
  curl -L --fail --progress-bar \
    -o "$dir/train-clean-100.tar.gz" \
    "https://www.openslr.org/resources/12/train-clean-100.tar.gz"
  tar -xzf "$dir/train-clean-100.tar.gz" -C "$dir"
  rm -f "$dir/train-clean-100.tar.gz"
  note "-> $dir/LibriSpeech/train-clean-100"
}

commonvoice() {
  log "Common Voice — Hindi and Punjabi"
  note "Licence: CC0 · needs a (free) Mozilla account for the download link"
  note "MANUAL: https://commonvoice.mozilla.org/en/datasets"
  note "  pick 'Hindi' and 'Punjabi', accept the terms, copy the download URLs"
  note "  then place the extracted archives at:"
  note "    $RAW/commonvoice/hi/"
  note "    $RAW/commonvoice/pa/"
  mkdir -p "$RAW/commonvoice/hi" "$RAW/commonvoice/pa"
}

physionet_af() {
  log "PhysioNet/CinC 2017 AF Challenge (rhythm irregularity)"
  note "Licence: ODC-BY 1.0 · ~700 MB"
  local dir="$RAW/physionet_af2017"
  mkdir -p "$dir"
  if [ -d "$dir/training2017" ]; then note "already present, skipping"; return; fi
  curl -L --fail --progress-bar \
    -o "$dir/training2017.zip" \
    "https://physionet.org/files/challenge-2017/1.0.0/training2017.zip"
  unzip -q "$dir/training2017.zip" -d "$dir"
  rm -f "$dir/training2017.zip"
  note "-> $dir/training2017"
}

# --------------------------------------------------------------------------- gated
torgo() {
  log "TORGO (dysarthric speech) — REQUEST REQUIRED"
  note "Licence: research use, by agreement"
  note "MANUAL: email the maintainers at the University of Toronto"
  note "  http://www.cs.toronto.edu/~complingweb/data/TORGO/torgo.html"
  note "  state: academic/research use, non-commercial, no redistribution"
  note "  turnaround: typically days"
  note "  place the extracted corpus at: $RAW/torgo/"
  mkdir -p "$RAW/torgo"
}

uaspeech() {
  log "UASpeech (dysarthric speech) — LICENCE AGREEMENT REQUIRED"
  note "Licence: signed agreement with the University of Illinois"
  note "MANUAL: http://www.isle.illinois.edu/sst/data/UASpeech/"
  note "  complete the request form; a signature from your institution is required"
  note "  turnaround: typically 1-3 weeks — start this one first"
  note "  place the extracted corpus at: $RAW/uaspeech/"
  mkdir -p "$RAW/uaspeech"
}

mpower() {
  log "mPower (Parkinson's, for the asymmetry discriminator) — CERTIFICATION REQUIRED"
  note "Licence: Synapse account + data-use certification (a short quiz)"
  note "MANUAL: https://www.synapse.org/#!Synapse:syn4993293"
  note "  register, complete the certification, then agree to the mPower conditions"
  note "  turnaround: same day once certified"
  note "  place the tapping-activity export at: $RAW/mpower/"
  mkdir -p "$RAW/mpower"
}

# --------------------------------------------------------------------------- main
case "${1:-all}" in
  librispeech)  librispeech ;;
  commonvoice)  commonvoice ;;
  physionet|af) physionet_af ;;
  torgo)        torgo ;;
  uaspeech)     uaspeech ;;
  mpower)       mpower ;;
  all)
    librispeech
    physionet_af
    commonvoice
    log "The following need a human. Start them now — they gate models 1 and 3."
    torgo
    uaspeech
    mpower
    ;;
  *) echo "unknown dataset: $1" >&2; exit 1 ;;
esac

log "Done."
note "Provenance, licence and consent status for each: data/README.md"

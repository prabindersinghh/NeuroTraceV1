# NEUROTRACE — DATASETS & MODEL STRATEGY v2.0

## STRATEGIC NOTE
Paraspeak won our exact theme partly by BUILDING ITS OWN INDIAN CLINICAL DATASET
(1,407 samples, 28 patients) rather than only using foreign corpora. Judges rewarded that.
Our dataset plan must therefore have two arms:
  ARM 1 — public corpora to build and validate the pipeline NOW
  ARM 2 — our own Indian-language, stroke-specific collection (the differentiator)

═══════════════════════════════════════════════════════════
## ARM 1 — PUBLIC DATASETS (download these, in this order)
═══════════════════════════════════════════════════════════

### SPEECH (priority 1 — our strongest modality)
1. TORGO — dysarthric + control speech, aligned articulatory data.  ★ START HERE
   Use: train dysarthria likelihood classifier; validate jitter/shimmer/HNR separation.
   http://www.cs.toronto.edu/~complingweb/data/TORGO/torgo.html  (free, registration)
2. UA-Speech — dysarthric speech, 15 speakers with cerebral palsy.
   http://www.isle.illinois.edu/sst/data/UASpeech/  (request access)
3. LibriSpeech — healthy control baseline, free, large.
   https://www.openslr.org/12   (use train-clean-100 subset only)
4. Mozilla Common Voice — Hindi + Punjabi healthy speech, CC0.  ★ INDIAN LANGUAGE
   https://commonvoice.mozilla.org/en/datasets
5. AI4Bharat IndicSUPERB / Shrutilipi — Indian-language ASR corpora.  ★ INDIAN LANGUAGE
   https://ai4bharat.iitm.ac.in/  (Hindi/Punjabi acoustic priors)
6. DementiaBank Pitt Corpus — Cookie Theft picture descriptions, cognitive decline.
   https://dementia.talkbank.org/  (membership required; optional)

### FACE (priority 2)
7. Toronto NeuroFace — post-stroke and ALS facial videos WITH clinician scores. ★ BEST MATCH
   Request from authors (search "Toronto NeuroFace dataset"). Directly relevant.
8. CK+ (Extended Cohn-Kanade) — facial action units, free for research.
   Use: validate smile/eye symmetry extraction. http://www.jeffcohn.net/Resources/
9. YouTube Facial Palsy Database (YFP) — facial palsy videos.
   Use: central vs peripheral discrimination. Search "YouTube Facial Palsy dataset".
10. MEEI Facial Palsy / Facial Palsy Grading sets — House-Brackmann graded images.
NOTE: For face we mostly need MediaPipe (pretrained, no training) + labelled clips for
VALIDATION of our symmetry metrics. Do not attempt to train a face model from scratch.

### MOTOR / REACTION / GAIT
11. mPower (Parkinson's, Synapse) — smartphone tapping, voice, gait, from real patients.
    https://www.synapse.org/#!Synapse:syn4993293   ★ Use for tapping/gait feature validation
    ALSO critical as a NEGATIVE control: Parkinson's shows BILATERAL slowing; stroke shows
    ASYMMETRY. Use mPower to prove our asymmetry ratio discriminates.
12. PhysioNet Gait in Neurodegenerative Disease Database.
    https://physionet.org/content/gaitndd/
13. Reaction time: generate our own; no download needed.

### CARDIAC (PPG / rhythm)
14. MIMIC-III Waveform / PhysioNet PPG-DaLiA — PPG signals with rhythm labels.
    https://physionet.org/content/pulse-transit-time-ppg/
15. PhysioNet AF Classification Challenge 2017 — short single-lead recordings, AF labels.
    https://physionet.org/content/challenge-2017/
    Use: validate rr_irregularity_index thresholds for "irregular rhythm" flag.

### COGNITION
16. No suitable public dataset for our tablet tasks — we generate normative data ourselves.
    Use published Indian norms for cut-offs: ICMR-NCTB, ACE-III India (education-stratified),
    HMSE (education-fair MMSE for low-literacy). Cite, do not train on.

═══════════════════════════════════════════════════════════
## ARM 2 — OUR OWN DATASET (the competitive differentiator)
═══════════════════════════════════════════════════════════
Target: NeuroTrace Punjab Post-Stroke Corpus
  · 20-30 consenting post-stroke participants + 20-30 age-matched controls
  · Recruit via Patiala/Chandigarh neurology departments and physiotherapy clinics
  · Per participant: 5-10 sessions of the full daily battery in Hindi/Punjabi
  · Paired clinician rating (NIHSS items 4/9/10, MoCA, mRS) as ground truth
  · Store: features + clinician labels. Keep raw media only with explicit consent.
  · Ethics: Institutional Ethics Committee approval + CTRI registration
This is what makes the pitch. "We built India's first Punjabi/Hindi post-stroke
multimodal exam dataset" is a sentence no competing team can say.

═══════════════════════════════════════════════════════════
## MODEL STRATEGY (what to train vs what to use pretrained)
═══════════════════════════════════════════════════════════
USE PRETRAINED (do not train):
  · MediaPipe FaceMesh / Pose / Hands — all facial and limb landmarks
  · Speech DSP (librosa/parselmouth equivalents) — classical, no training
  · Gemma 3 1B / Llama 3.2 1B Q4 — the explanation SLM, used as-is
  · Optional: Wav2Vec2 / ECAPA-TDNN embeddings for voice identity matching

TRAIN (small, classical, reproducible — seed=42):
  · voice_dysarthria_clf   : TORGO(+UASpeech) vs LibriSpeech/CommonVoice
                             → XGBoost or LogisticRegression on our speech features
                             → output dysarthria_likelihood in [0,1] as ONE extra feature
                             → report ROC-AUC, sensitivity, specificity, confusion matrix
  · rhythm_irregularity_clf: PhysioNet AF Challenge → threshold/LogReg on RR irregularity
  · asymmetry_discriminator: mPower (PD, bilateral) vs stroke asymmetry logic
                             → demonstrate our asymmetry_ratio separates the two
NEVER TRAIN a model that outputs a diagnosis or a "stroke risk". Only per-modality
likelihoods that feed the deterministic engine as additional features.

## REPORTING (for the pitch — judges reward honest metrics)
For every trained model publish: dataset, n, split method, ROC-AUC, sensitivity,
specificity, and known limitations (language mismatch, population mismatch, small n).
Paraspeak published its word error rate. We publish ours.

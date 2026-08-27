# PLAN_AWAAZ — the communication assistant

Second product inside the same platform. **Status: IN PROGRESS — the board, confirmation
contract, listener capability, and consented on-device card/audio and caregiver-reviewed
repeat pairs exist. Those pairs can be integrity-verified into an explicitly acknowledged
local training archive; the app never uploads it. A caregiver can also record and self-test
the fixed emergency phrase as a local WAV that starts before any network request, and the
emergency surface can open the phone dialer with India's 108 number prefilled. Patient-speech ASR, original
conversational-audio capture, adapter training/deployment, live provider field testing, and
caregiver-number calling remain incomplete.**

---

## The clinical constraint everything else is arranged around

**Dysarthria** — the muscles that shape sound are damaged; the message is intact.
→ AI may **translate automatically**. You are recovering a signal that exists.

**Aphasia** — language itself is damaged; the message may not exist yet.
→ AI may **only offer candidates the patient confirms**. It must **never auto-speak**.

Auto-completing an aphasic patient's sentence puts words in a disabled person's mouth that
neither they nor the listener can distinguish from their own. If the guess is wrong, the
person has been made to say something they did not mean, in their own voice, to their own
family — and they may not have the language left to correct it.

**The confirmation loop is a safety mechanism, not a UX preference.**

### How this is enforced in code

Auto-speak is reachable only when **both** hold:
1. the patient's profile is **dysarthria-dominant**, and
2. transcript confidence exceeds the configured threshold.

A single function, `may_auto_speak(profile, confidence) -> bool`, is the only path to
speech-without-confirmation, and it returns `False` for any aphasia-dominant or mixed
profile regardless of confidence. Pinned by
`test_an_aphasia_profile_can_never_auto_speak`, which sweeps confidence from 0.0 to 1.0.

This becomes **INV-9**.

---

## D1 — phrase board + voice (PARTIAL)

### Data model (additive)

| Table | Purpose |
|---|---|
| `awaaz_profiles` | per patient: `speech_profile` (dysarthria_dominant / aphasia_dominant / mixed), `auto_speak_enabled`, `auto_speak_threshold`, voice status |
| `phrase_cards` | patient's grid: text, language, icon, slot, category, usage count |
| `voice_samples` | metadata for an uploaded family-archive clip — **duration and status only, never the audio** |
| `utterance_log` | what was spoken, when, from which card; optional on-device audio receipt and revocation metadata, never bytes |

**INV-1 still holds.** The 2-minute voice clip is the one piece of raw audio that must reach
a server, because cloning cannot happen on-device. It is therefore handled as a **separate,
explicitly consented, single-purpose upload** to object storage — never into Neon, never
through the exam path, deleted after the adapter is trained, with the deletion recorded.
This is a deliberate, documented exception and gets its own decision entry (D-014) rather
than being quietly folded into INV-1.

### Endpoints
```
GET    /awaaz/{pid}/board            the phrase grid
POST   /awaaz/{pid}/cards            add/edit a card
DELETE /awaaz/cards/{card_id}
POST   /awaaz/{pid}/speak            resolve a card to speech; returns whether it may
                                     auto-speak or must be confirmed; may register a
                                     consented local card/audio receipt
DELETE /awaaz/audio-pairs/{capture}  record revocation after local deletion
POST   /awaaz/{pid}/emergency        record emergency phrase + optional location and
                                     on-device playback receipt (never audio bytes)
POST   /awaaz/review/{utterance}     save a verified text label; optionally register a
                                     consented local patient-repeat receipt
GET    /awaaz/{pid}/profile
PATCH  /awaaz/{pid}/profile          set speech profile (clinician or caregiver)
```

### Phrase board
Default grid, configurable per patient, in the patient's own language: water · toilet ·
pain · call my son · I'm fine · sit with me · too fast · yes · no.

One tap speaks. Cards are ordered by use, so the ones that matter surface without the
patient hunting.

### Voice
- **XTTS-v2** for the clone; **Sarvam** evaluated for Indic quality (see PLAN_ML).
- Caregiver uploads any 2-minute pre-stroke clip — wedding video, WhatsApp voice note.
- Until a clone exists, the board speaks in a stock voice. **The product works on day one
  with no training**; the clone is an upgrade, not a prerequisite.

### Emergency mode
The persistent red control speaks *"I need help"* from a caregiver-recorded WAV held in
origin-scoped IndexedDB. Setup includes a visible playback self-test and explicit deletion.
Holding non-interactive space for 1.2 seconds activates the same path; finger movement
cancels it so scrolling cannot fire an alert. Exact location is opt-in and requested only
for an emergency. A configured SMTP provider can notify the owning caregiver and reports
success only after their address is accepted; deployments without credentials stay false.
An explicit `tel:108` control opens the phone app from both the connected board and the
emergency-only offline fallback. It does not auto-dial or claim that a call connected.
Calling a caregiver remains future work because the current contract has no consented phone
number or contact-selection model.

**Two hard requirements:**
- Works **fully offline after setup**. The phrase audio is recorded once and loaded from
  on-device storage; nothing is synthesised at the moment of need. If playback is rejected,
  the UI labels browser TTS as a fallback and the API receipt remains false.
- **Never depends on speech recognition to succeed.** A person in crisis is the least
  intelligible they will ever be, and ASR is the component most likely to fail exactly then.

---

## D2 — listener mode (PARTIAL — localized capability + `Listen.tsx`; no live ASR source yet)
Shareable browser link, no install, showing live cleaned text of what the survivor is
saying, plus one line of listener coaching: *"Give him 10 extra seconds. Don't finish his
sentences. Ask yes/no questions if he's stuck."*

The capability pins EN, HI, or PA when minted. New share URLs carry that language so the
loading, connection-error, and expired states are localized before the first API response;
the server response remains authoritative once available. Coaching was already localized
server-side, and the surrounding shell, TTL disclosure, privacy notice, empty state, and
retry path now use the same language. Each confirmed utterance also declares its own
language for assistive technology. No patient name, health history, scores, or audio is
added to the capability. The sharing screen keeps an explicit stop-sharing control next to
the active URL. Revocation is authorized against the patient, retry-idempotent, audited
once, and immediately turns the public view into the same 404 as an expired or unknown
token. Possessing the public read capability does not grant revoke authority.

Every conversation puts the product in a stranger's browser. That is also the distribution
mechanism.

## D3 — personalised ASR (PARTIAL — capture endpointing exists; ASR/adapter do not)
- Base: distil-Whisper or IndicWav2Vec2 + CTC head.
- **Reduce language-model weight during decoding.** General ASR fails on dysarthric speech
  by producing fluent, confident, *wrong* output — it leans on its language prior. We want
  acoustic faithfulness, so prefer phoneme/CTC-level output downstream stages can reason
  about.
- **End-of-utterance silence threshold user-tunable to 3–4 s.** The board now exposes
  0.5–4.0 s and applies it to optional silence auto-stop; push-to-talk/manual stop remains
  the default. Endpointing never starts its silence clock before speech is detected.
- Per-patient LoRA adapters, trained nightly server-side, shipped back for local inference.
- A versioned local tar now provides a human-controlled, integrity-checked handoff of
  consented pairs. A strict non-extracting verifier now checks the schema, paths, UUID
  associations, bounds, WAV headers and hashes. It then refuses training because the LoRA
  implementation, evaluation, model registry, and adapter shipment are not connected. This
  is verified training input—not a deployed personalised ASR system.
- **Latency target: < 1 s.** Above ~2 s the conversation dies regardless of accuracy.

## D4 — passive learning loop (PARTIAL — local card + reviewed-repeat pairs)
Never ask a tired stroke survivor for 500 phrases up front — that is why Project Relate
stalls. The current board offers an explicit practice capture: record, then tap the exact
card. Its 16 kHz WAV stays in origin-scoped IndexedDB while Neon receives only a UUID,
duration, SHA-256/size, target, consent actor/time and deletion state. Retention is opt-in,
deletable, bounded to 30 seconds, and retry-safe. During the caregiver's short review, a
text correction stays text-only unless the patient explicitly agrees to say the verified
words again. That fresh repeat is previewable, locally retained, label-locked across retry,
and registered through the same metadata-only receipt. A separate explicit export verifies
each WAV and downloads a versioned tar containing labels and media; the UI warns that this
sensitive file leaves protected app storage and cannot be remotely revoked. Nothing is
uploaded by the app. Original conversational audio is not captured or reconstructable; that
still depends on a consented patient-speech ASR path.

## D5 — convergence with monitoring (algorithm scaffold; no production audio path)
Every utterance is also a speech sample. Route articulation rate, pause structure, voice
quality, word-finding latency and vocabulary diversity into the **same** feature pipeline
the monitoring engine uses — monitoring data at conversational density, zero adherence
burden.

**Apply the frozen-reference trick here too.** Keep the day-30 ASR adapter permanently. If
today's speech scores worse against the **frozen** adapter, their speech has objectively
deteriorated — even while the live adapted model compensates perfectly. Same insight as
D-013, applied to a different model.

---

## Risks

1. **Voice cloning is impersonation technology.** Consent must be from the patient where
   they can give it, and the clone must be deletable on request, permanently.
2. **A mixed dysarthria/aphasia profile is common.** Treated as aphasia-dominant for safety —
   never auto-speak.
3. **Emergency mode failing silently is worse than not having it.** Needs a visible
   self-test the caregiver can run.

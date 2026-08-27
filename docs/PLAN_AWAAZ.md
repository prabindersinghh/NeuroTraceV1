# PLAN_AWAAZ — the communication assistant

Second product inside the same platform. **Status: IN PROGRESS — the board, confirmation
contract, listener capability, and text-review queue exist; ASR, audio-backed learning,
caregiver delivery, and pre-rendered offline emergency audio are not connected.**

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
| `utterance_log` | what was spoken, when, from which card |

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
                                     auto-speak or must be confirmed
POST   /awaaz/{pid}/emergency        record emergency phrase + optional location
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
Long-press anywhere → speaks *"I need help"* loudly in their voice, sends location,
one-tap family call.

**Two hard requirements:**
- Works **fully offline**. The phrase audio is pre-rendered and cached; nothing is
  synthesised at the moment of need.
- **Never depends on speech recognition to succeed.** A person in crisis is the least
  intelligible they will ever be, and ASR is the component most likely to fail exactly then.

---

## D2 — listener mode (PARTIAL — capability + `Listen.tsx`; no live ASR source yet)
Shareable browser link, no install, showing live cleaned text of what the survivor is
saying, plus one line of listener coaching: *"Give him 10 extra seconds. Don't finish his
sentences. Ask yes/no questions if he's stuck."*

Every conversation puts the product in a stranger's browser. That is also the distribution
mechanism.

## D3 — personalised ASR (planned)
- Base: distil-Whisper or IndicWav2Vec2 + CTC head.
- **Reduce language-model weight during decoding.** General ASR fails on dysarthric speech
  by producing fluent, confident, *wrong* output — it leans on its language prior. We want
  acoustic faithfulness, so prefer phoneme/CTC-level output downstream stages can reason
  about.
- **End-of-utterance silence threshold user-tunable to 3–4 s.** Default VAD cutting
  dysarthric speakers off mid-sentence is the leading cause of abandonment in this category.
- Per-patient LoRA adapters, trained nightly server-side, shipped back for local inference.
- **Latency target: < 1 s.** Above ~2 s the conversation dies regardless of accuracy.

## D4 — passive learning loop (PARTIAL — text review exists; audio pairs do not)
Never ask a tired stroke survivor for 500 phrases up front — that is why Project Relate
stalls. Instead: when the patient taps a card, silently record what they also said aloud →
a free audio/target pair. Caregiver's 2-minute evening task replays unclear utterances and
asks what they meant. Framed as *"help Papa's app understand him better"* — caregivers
mostly feel helpless, and this gives them something useful to do.

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

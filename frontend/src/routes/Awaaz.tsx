/**
 * Awaaz — the communication board. `/awaaz/:patientId`.
 *
 * THE CLINICAL CONSTRAINT THIS SCREEN EXISTS TO ENFORCE (INV-9)
 * -------------------------------------------------------------
 * Dysarthria: the muscles are broken, the MESSAGE is intact → recognised speech may be
 * spoken automatically above the confidence threshold.
 * Aphasia: the LANGUAGE system is broken, the intended message may not exist in the words
 * produced → the system only ever OFFERS candidates, and nothing is spoken until the
 * patient taps one. Auto-speaking a guess puts words in the mouth of someone who cannot
 * veto them.
 *
 * The server is the authority on that gate (`may_auto_speak`, pinned by tests). This UI
 * never routes around it: free text goes to `/speak`, and what comes back decides whether
 * anything is voiced — `speak_now` or a `candidates` list requiring a tap. CARDS are
 * always spoken on tap: the patient chose those exact words themselves.
 *
 * Cards are big, icon-first, and ordered by the server (frequency-ranked). Tapping one is
 * also a labelled training pair for the personalisation loop (D4) — the server logs it;
 * this screen just uses the board.
 */
import { AlertTriangle, Volume2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { AwaazBoard, AwaazSpeakResult } from "@/lib/types";

function voice(text: string, lang: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = { en: "en-IN", hi: "hi-IN", pa: "pa-IN" }[lang] ?? "en-IN";
    u.rate = 0.95;
    window.speechSynthesis?.cancel();
    window.speechSynthesis?.speak(u);
  } catch { /* no TTS — the text is still displayed large */ }
}

export default function Awaaz() {
  const { patientId = "" } = useParams();
  const { t, lang } = useI18n();
  const [board, setBoard] = useState<AwaazBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [lastSpoken, setLastSpoken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.awaazBoard(patientId)
      .then((b) => live && setBoard(b))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [patientId]);

  const speakCard = useCallback(async (cardId: string, text: string, cardLang: string) => {
    voice(text, cardLang); // voiced immediately — the patient chose these exact words
    setLastSpoken(text);
    api.awaazSpeak(patientId, { card_id: cardId, lang: cardLang }).catch(() => undefined);
  }, [patientId]);

  const submitFree = useCallback(async () => {
    if (!freeText.trim()) return;
    setBusy(true);
    setCandidates([]);
    try {
      const res: AwaazSpeakResult = await api.awaazSpeak(patientId, {
        text: freeText.trim(), lang,
      });
      if (res.speak_now && res.text) {
        // Dysarthria path, above threshold — the server said yes.
        voice(res.text, res.lang);
        setLastSpoken(res.text);
        setFreeText("");
      } else if (res.requires_confirmation) {
        // Aphasia path — candidates only. NOTHING is voiced until a tap.
        setCandidates(res.candidates.length ? res.candidates : [freeText.trim()]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [freeText, lang, patientId]);

  const confirmCandidate = useCallback((text: string) => {
    voice(text, lang);
    setLastSpoken(text);
    setCandidates([]);
    setFreeText("");
    api.awaazSpeak(patientId, { text, lang, candidates: [text] }).catch(() => undefined);
  }, [lang, patientId]);

  const emergency = useCallback(async () => {
    // Pre-rendered path: voiced locally FIRST, then the server notifies the caregiver.
    // A person in crisis must not wait on a network round trip to be heard.
    const msg = {
      en: "I need help. Please come now.",
      hi: "मुझे मदद चाहिए। अभी आइए।",
      pa: "ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ। ਹੁਣੇ ਆਓ।",
    }[lang] ?? "I need help. Please come now.";
    voice(msg, lang);
    setLastSpoken(msg);
    api.awaazEmergency(patientId).catch(() => undefined);
  }, [lang, patientId]);

  if (error && !board) return <AppShell><ErrorState message={error} /></AppShell>;
  if (!board) return <AppShell><LoadingState /></AppShell>;

  const isAphasia = board.profile.speech_profile !== "dysarthria_dominant";

  return (
    <AppShell>
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        {/* Emergency is first, biggest, and always the same place. */}
        <button
          type="button"
          onClick={() => void emergency()}
          className="flex min-h-20 items-center justify-center gap-3 rounded-2xl bg-alert text-2xl font-semibold text-white"
        >
          <AlertTriangle className="h-8 w-8" aria-hidden /> {t("awaazEmergency")}
        </button>

        {lastSpoken && (
          <p className="flex items-center gap-2 rounded-xl border border-line bg-secondary p-4 text-xl">
            <Volume2 className="h-6 w-6 shrink-0 text-accent" aria-hidden />
            <span aria-live="polite">{lastSpoken}</span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          {board.cards.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => void speakCard(c.id, c.text, c.lang)}
              className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-line p-3 text-xl active:border-accent"
            >
              {c.icon && <span className="text-3xl" aria-hidden>{c.icon}</span>}
              <span>{c.text}</span>
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-line p-4">
          <label className="block text-base text-muted-foreground">
            {isAphasia ? t("awaazTypeConfirm") : t("awaazTypeSpeak")}
          </label>
          <div className="mt-2 flex gap-2">
            <input
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              className="min-h-14 flex-1 rounded-xl border border-line px-4 text-xl"
            />
            <Button className="min-h-14 px-5" disabled={busy || !freeText.trim()}
              onClick={() => void submitFree()}>
              {isAphasia ? t("awaazOffer") : t("awaazSay")}
            </Button>
          </div>

          {candidates.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">{t("awaazPickOne")}</p>
              {candidates.map((c) => (
                <button key={c} type="button" onClick={() => confirmCandidate(c)}
                  className="min-h-14 rounded-xl border-2 border-accent/50 px-4 text-left text-xl">
                  {c}
                </button>
              ))}
              <button type="button" onClick={() => setCandidates([])}
                className="min-h-11 text-sm text-muted-foreground underline">
                {t("awaazNone")}
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {isAphasia ? t("awaazAphasiaNote") : t("awaazDysarthriaNote")}
        </p>
      </div>
    </AppShell>
  );
}

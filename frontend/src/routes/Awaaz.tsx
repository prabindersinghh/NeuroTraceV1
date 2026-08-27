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
 * Cards are big, icon-first, and ordered by the server (frequency-ranked). The server
 * logs a tap as a confirmed communication event; audio-backed personalisation is a later
 * milestone and is not implied by that text-only audit row.
 */
import {
  Accessibility,
  AlertTriangle,
  Bath,
  Check,
  CircleCheck,
  Gauge,
  GlassWater,
  Hand,
  HeartPulse,
  MessageSquare,
  Phone,
  Users,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { confirmedCandidatePayload, emergencyPhrase } from "@/lib/awaaz";
import { useI18n } from "@/lib/i18n";
import type { AwaazBoard, AwaazSpeakResult } from "@/lib/types";

const CARD_ICONS: Record<string, LucideIcon> = {
  alert: AlertTriangle,
  water: GlassWater,
  toilet: Bath,
  pain: HeartPulse,
  phone: Phone,
  ok: CircleCheck,
  yes: Check,
  no: X,
  company: Users,
  slow: Gauge,
  wait: Hand,
  accessibility: Accessibility,
};

function PhraseIcon({ name }: { name: string | null }) {
  const Icon = (name && CARD_ICONS[name]) || MessageSquare;
  return <Icon className="h-8 w-8 text-accent" aria-hidden />;
}

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
  const [actionError, setActionError] = useState<string | null>(null);
  const [emergencyWarning, setEmergencyWarning] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.awaazBoard(patientId)
      .then((b) => live && setBoard(b))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [patientId]);

  const speakCard = useCallback(async (cardId: string, text: string, cardLang: string) => {
    setActionError(null);
    voice(text, cardLang); // voiced immediately — the patient chose these exact words
    setLastSpoken(text);
    try {
      await api.awaazSpeak(patientId, { card_id: cardId, lang: cardLang });
    } catch {
      // Communication still works locally, but never claim its audit record was saved.
      setActionError(t("awaazNotSaved"));
    }
  }, [patientId, t]);

  const submitFree = useCallback(async () => {
    if (!freeText.trim()) return;
    setBusy(true);
    setCandidates([]);
    setActionError(null);
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
      setActionError(e instanceof Error ? e.message : t("awaazNotSaved"));
    } finally {
      setBusy(false);
    }
  }, [freeText, lang, patientId, t]);

  const confirmCandidate = useCallback(async (text: string) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.awaazSpeak(
        patientId,
        confirmedCandidatePayload(text, lang),
      );
      if (!res.speak_now || !res.text) throw new Error("Candidate was not accepted");
      // The server has now retained the tap as the confirmation event. Only this response
      // completes the candidate path; sending the same candidate list again would loop.
      voice(res.text, res.lang);
      setLastSpoken(res.text);
      setCandidates([]);
      setFreeText("");
    } catch {
      setActionError(t("awaazConfirmFailed"));
    } finally {
      setBusy(false);
    }
  }, [lang, patientId, t]);

  const emergency = useCallback(async () => {
    // Voice locally first so a network round trip is never on the critical path. This is
    // best-effort stock browser synthesis until pre-rendered offline audio is connected.
    const msg = emergencyPhrase(board, lang);
    voice(msg, lang);
    setLastSpoken(msg);
    setEmergencyWarning(null);
    try {
      const result = await api.awaazEmergency(patientId);
      if (!result.caregiver_notified) {
        setEmergencyWarning(t("awaazEmergencyDeliveryMissing"));
      }
    } catch {
      setEmergencyWarning(t("awaazEmergencyDeliveryMissing"));
    }
  }, [board, lang, patientId, t]);

  const [listenerLink, setListenerLink] = useState<string | null>(null);

  /**
   * Mint a short-lived listener link. The token IS the capability, so the display name is
   * the caregiver's choice and defaults to something non-identifying — a link can be
   * forwarded, and a stranger does not need the patient's full name to help them.
   */
  const mintListenerLink = useCallback(async () => {
    if (listenerLink) {
      await navigator.clipboard?.writeText(listenerLink).catch(() => undefined);
      return;
    }
    try {
      setActionError(null);
      const res = await api.awaazMintListener(patientId, {
        display_name: t("awaazListenerDefaultName"),
        lang, ttl_minutes: 30,
      });
      const url = `${window.location.origin}/listen/${res.token}`;
      setListenerLink(url);
      await navigator.clipboard?.writeText(url).catch(() => undefined);
    } catch {
      setActionError(t("awaazListenerFailed"));
    }
  }, [lang, listenerLink, patientId, t]);

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

        {emergencyWarning && (
          <p role="alert" className="rounded-xl border border-alert/40 bg-alert-soft p-4 text-base text-alert">
            {emergencyWarning}
          </p>
        )}

        {actionError && (
          <p role="alert" className="rounded-xl border border-alert/40 bg-alert-soft p-4 text-base text-alert">
            {actionError}
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
              <PhraseIcon name={c.icon} />
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
                <button key={c} type="button" disabled={busy}
                  onClick={() => void confirmCandidate(c)}
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
        {/* Caregiver actions. Deliberately at the BOTTOM and visually quiet: the patient
            uses the top of this screen to speak, and a share button competing with the
            emergency card would be a design failure with real consequences. */}
        <section className="mt-2 flex flex-col gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => void mintListenerLink()}
            className="min-h-12 rounded-xl border border-line px-4 text-sm"
          >
            {listenerLink ? t("awaazListenerCopy") : t("awaazListenerShare")}
          </button>
          {listenerLink && (
            <p className="break-all rounded-xl border border-line bg-secondary p-3 text-xs">
              {listenerLink}
            </p>
          )}
          <Link
            to={`/review/${patientId}`}
            className="min-h-12 rounded-xl border border-line px-4 py-3 text-center text-sm"
          >
            {t("awaazReviewTonight")}
          </Link>
        </section>
      </div>
    </AppShell>
  );
}

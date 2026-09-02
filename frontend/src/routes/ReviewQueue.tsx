/**
 * The caregiver's evening review — `/review/:patientId`.
 *
 * WHAT THIS ACTUALLY IS: a short queue where a caregiver verifies what the person meant.
 * Text-only corrections remain labels only. With explicit patient consent, the caregiver
 * can also record one fresh repeat of the verified words; that WAV stays in IndexedDB and
 * becomes a real local audio/target pair only after its metadata receipt saves.
 *
 * WHY IT IS SHORT AND WORST-FIRST
 * The server orders by lowest confidence and caps the list. A caregiver who does only
 * three items should have done the three that bought the most, and a list that scrolls
 * forever teaches them to do none of it. "Nothing to review" is a legitimate, common,
 * and good outcome — it is shown as success, not emptiness.
 *
 * WHAT IT IS NOT: a transcript. Emergency utterances are excluded server-side and never
 * appear here. A review screen is not a place to re-read someone's worst moment.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import {
  deleteLocalAudioPair,
  getLocalAudioPairForUtterance,
  saveLocalAudioPair,
  sha256Blob,
} from "@/lib/awaazAudioVault";
import { useI18n } from "@/lib/i18n";
import {
  startAudioRecording,
  wavDurationSeconds,
  type AudioRecorder,
} from "@/lib/recording";

interface ReviewItem {
  id: string;
  text: string;
  lang: string;
  confidence: number | null;
  ts: string;
}

interface PendingReviewAudio {
  captureId: string;
  utteranceId: string;
  blob: Blob;
  durationSeconds: number;
  sha256?: string;
  targetText?: string;
  savedLocally: boolean;
}

const COPY = {
  eyebrow: { en: "Speech review", hi: "बोली की जाँच", pa: "ਬੋਲੀ ਦੀ ਜਾਂਚ" },
  title: { en: "This evening's review", hi: "आज शाम की जाँच", pa: "ਅੱਜ ਸ਼ਾਮ ਦੀ ਜਾਂਚ" },
  intro: {
    en: "We were unsure about these. Each correction saves a verified label for future personalisation.",
    hi: "इनके बारे में हमें ठीक से पता नहीं चला। हर सुधार भविष्य में निजी बनाने के लिए एक सत्यापित लेबल सहेजता है।",
    pa: "ਇਹਨਾਂ ਬਾਰੇ ਸਾਨੂੰ ਠੀਕ ਪਤਾ ਨਹੀਂ ਲੱਗਾ। ਹਰ ਸੋਧ ਭਵਿੱਖ ਦੇ ਨਿੱਜੀਕਰਨ ਲਈ ਇੱਕ ਪੁਸ਼ਟੀ ਕੀਤਾ ਲੇਬਲ ਸੰਭਾਲਦੀ ਹੈ।",
  },
  heard: { en: "We heard", hi: "हमने सुना", pa: "ਅਸੀਂ ਸੁਣਿਆ" },
  meant: { en: "They meant", hi: "उनका मतलब था", pa: "ਉਹਨਾਂ ਦਾ ਮਤਲਬ ਸੀ" },
  correct: { en: "Correct it", hi: "सुधारें", pa: "ਸੁਧਾਰੋ" },
  right: { en: "That was right", hi: "यह सही था", pa: "ਇਹ ਸਹੀ ਸੀ" },
  save: { en: "Save", hi: "सहेजें", pa: "ਸੰਭਾਲੋ" },
  empty: {
    en: "Nothing needs review tonight.",
    hi: "आज किसी सुधार की ज़रूरत नहीं है।",
    pa: "ਅੱਜ ਕਿਸੇ ਸੋਧ ਦੀ ਲੋੜ ਨਹੀਂ ਹੈ।",
  },
  done: {
    en: "Done. That correction was saved.",
    hi: "हो गया। सुधार सहेज लिया गया।",
    pa: "ਹੋ ਗਿਆ। ਸੋਧ ਸੰਭਾਲੀ ਗਈ।",
  },
  failed: {
    en: "That correction was not saved. It is still here — check the connection and try again.",
    hi: "यह सुधार सहेजा नहीं गया। यह अभी यहीं है — कनेक्शन जाँचकर फिर कोशिश करें।",
    pa: "ਇਹ ਸੁਧਾਰ ਸੰਭਾਲਿਆ ਨਹੀਂ ਗਿਆ। ਇਹ ਹਾਲੇ ਇੱਥੇ ਹੀ ਹੈ — ਕਨੈਕਸ਼ਨ ਜਾਂਚ ਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  audioTitle: {
    en: "Optional patient repeat",
    hi: "वैकल्पिक रोगी दोहराव",
    pa: "ਵਿਕਲਪਿਕ ਮਰੀਜ਼ ਦੁਹਰਾਵਾ",
  },
  audioHelp: {
    en: "After confirming the words, the patient can say them once more. The WAV stays only on this device; the server receives a consent and integrity receipt, never the recording.",
    hi: "शब्दों की पुष्टि के बाद रोगी उन्हें एक बार फिर कह सकते हैं। WAV केवल इस डिवाइस पर रहती है; सर्वर को केवल सहमति और सत्यापन रसीद मिलती है, रिकॉर्डिंग कभी नहीं।",
    pa: "ਸ਼ਬਦਾਂ ਦੀ ਪੁਸ਼ਟੀ ਤੋਂ ਬਾਅਦ ਮਰੀਜ਼ ਉਹਨਾਂ ਨੂੰ ਇੱਕ ਵਾਰ ਫਿਰ ਕਹਿ ਸਕਦਾ ਹੈ। WAV ਸਿਰਫ਼ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਰਹਿੰਦੀ ਹੈ; ਸਰਵਰ ਨੂੰ ਸਿਰਫ਼ ਸਹਿਮਤੀ ਅਤੇ ਜਾਂਚ ਰਸੀਦ ਮਿਲਦੀ ਹੈ, ਰਿਕਾਰਡਿੰਗ ਕਦੇ ਨਹੀਂ।",
  },
  audioConsent: {
    en: "The patient agrees to record one repeat on this device",
    hi: "रोगी इस डिवाइस पर एक दोहराव रिकॉर्ड करने के लिए सहमत हैं",
    pa: "ਮਰੀਜ਼ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਇੱਕ ਦੁਹਰਾਵਾ ਰਿਕਾਰਡ ਕਰਨ ਲਈ ਸਹਿਮਤ ਹੈ",
  },
  record: { en: "Record repeat", hi: "दोहराव रिकॉर्ड करें", pa: "ਦੁਹਰਾਵਾ ਰਿਕਾਰਡ ਕਰੋ" },
  stop: { en: "Stop recording", hi: "रिकॉर्डिंग रोकें", pa: "ਰਿਕਾਰਡਿੰਗ ਰੋਕੋ" },
  discard: { en: "Delete recording", hi: "रिकॉर्डिंग हटाएँ", pa: "ਰਿਕਾਰਡਿੰਗ ਮਿਟਾਓ" },
  recording: { en: "Recording…", hi: "रिकॉर्ड हो रहा है…", pa: "ਰਿਕਾਰਡ ਹੋ ਰਿਹਾ ਹੈ…" },
  ready: {
    en: "Repeat ready. It will be paired only when this verified label saves.",
    hi: "दोहराव तैयार है। यह केवल सत्यापित लेबल सहेजे जाने पर जोड़ा जाएगा।",
    pa: "ਦੁਹਰਾਵਾ ਤਿਆਰ ਹੈ। ਇਹ ਸਿਰਫ਼ ਪੁਸ਼ਟੀ ਕੀਤਾ ਲੇਬਲ ਸੰਭਾਲਣ 'ਤੇ ਜੋੜਿਆ ਜਾਵੇਗਾ।",
  },
  restored: {
    en: "A local repeat from the previous failed save was restored for retry.",
    hi: "पिछले असफल सेव का स्थानीय दोहराव फिर कोशिश के लिए बहाल किया गया।",
    pa: "ਪਿਛਲੀ ਅਸਫਲ ਸੰਭਾਲ ਦਾ ਸਥਾਨਕ ਦੁਹਰਾਵਾ ਮੁੜ ਕੋਸ਼ਿਸ਼ ਲਈ ਬਹਾਲ ਕੀਤਾ ਗਿਆ।",
  },
  micFailed: {
    en: "Recording was not available. Check microphone permission and try again.",
    hi: "रिकॉर्डिंग उपलब्ध नहीं थी। माइक्रोफ़ोन अनुमति जाँचकर फिर कोशिश करें।",
    pa: "ਰਿਕਾਰਡਿੰਗ ਉਪਲਬਧ ਨਹੀਂ ਸੀ। ਮਾਈਕ੍ਰੋਫੋਨ ਇਜਾਜ਼ਤ ਜਾਂਚ ਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  tooShort: {
    en: "That recording was too short. Please try again.",
    hi: "वह रिकॉर्डिंग बहुत छोटी थी। फिर कोशिश करें।",
    pa: "ਉਹ ਰਿਕਾਰਡਿੰਗ ਬਹੁਤ ਛੋਟੀ ਸੀ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  labelLocked: {
    en: "This retry keeps the exact verified label paired with the saved local repeat.",
    hi: "दोबारा कोशिश में वही सत्यापित लेबल स्थानीय दोहराव के साथ जुड़ा रहेगा।",
    pa: "ਮੁੜ ਕੋਸ਼ਿਸ਼ ਵਿੱਚ ਉਹੀ ਪੁਸ਼ਟੀ ਕੀਤਾ ਲੇਬਲ ਸਥਾਨਕ ਦੁਹਰਾਵੇ ਨਾਲ ਜੁੜਿਆ ਰਹੇਗਾ।",
  },
} as const;

export default function ReviewQueue() {
  const { patientId = "" } = useParams();
  const { lang } = useI18n();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [audioConsent, setAudioConsent] = useState(false);
  const [pendingAudio, setPendingAudio] = useState<PendingReviewAudio | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const recordingUtteranceRef = useRef<string | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const editRequestRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.awaazReviewQueue(patientId);
      setItems(res.items as ReviewItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [patientId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!pendingAudio) {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(pendingAudio.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingAudio]);

  useEffect(() => () => {
    if (recordingTimerRef.current !== null) window.clearTimeout(recordingTimerRef.current);
    recorderRef.current?.cancel();
  }, []);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    const utteranceId = recordingUtteranceRef.current;
    if (!recorder || !utteranceId) return;
    recorderRef.current = null;
    recordingUtteranceRef.current = null;
    clearRecordingTimer();
    setRecordingId(null);
    try {
      const blob = await recorder.stop();
      const durationSeconds = wavDurationSeconds(blob);
      if (durationSeconds < 0.25) {
        setAudioStatus(COPY.tooShort[lang]);
        return;
      }
      setPendingAudio({
        captureId: crypto.randomUUID(),
        utteranceId,
        blob,
        durationSeconds,
        savedLocally: false,
      });
      setAudioStatus(COPY.ready[lang]);
    } catch {
      setAudioStatus(COPY.micFailed[lang]);
    }
  }, [clearRecordingTimer, lang]);

  const startRecording = useCallback(async (utteranceId: string) => {
    if (!audioConsent || recorderRef.current || pendingAudio) return;
    setAudioStatus(null);
    try {
      const recorder = await startAudioRecording();
      recorderRef.current = recorder;
      recordingUtteranceRef.current = utteranceId;
      setRecordingId(utteranceId);
      setAudioStatus(COPY.recording[lang]);
      // Stop just before the 30 s API ceiling so one final Web Audio buffer cannot push
      // an otherwise valid recording beyond the validated duration.
      recordingTimerRef.current = window.setTimeout(() => void stopRecording(), 29_500);
    } catch {
      setAudioStatus(COPY.micFailed[lang]);
    }
  }, [audioConsent, lang, pendingAudio, stopRecording]);

  const discardAudio = useCallback(async () => {
    clearRecordingTimer();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    recordingUtteranceRef.current = null;
    setRecordingId(null);
    const discarded = pendingAudio;
    setPendingAudio(null);
    setAudioConsent(false);
    setAudioStatus(null);
    if (discarded?.savedLocally) {
      await deleteLocalAudioPair(discarded.captureId).catch(() => undefined);
      await api.awaazDeleteAudioPair(discarded.captureId).catch(() => undefined);
    }
  }, [clearRecordingTimer, pendingAudio]);

  const beginEdit = useCallback(async (item: ReviewItem) => {
    editRequestRef.current = item.id;
    setEditing(item.id);
    setDraft(item.text);
    setAudioConsent(false);
    setPendingAudio(null);
    setAudioStatus(null);
    const restored = await getLocalAudioPairForUtterance(patientId, item.id).catch(() => null);
    if (!restored || editRequestRef.current !== item.id) return;
    setDraft(restored.target_text);
    setAudioConsent(true);
    setPendingAudio({
      captureId: restored.capture_id,
      utteranceId: item.id,
      blob: restored.audio,
      durationSeconds: restored.duration_seconds,
      sha256: restored.sha256,
      targetText: restored.target_text,
      savedLocally: true,
    });
    setAudioStatus(COPY.restored[lang]);
  }, [lang, patientId]);

  const submit = useCallback(async (id: string, corrected: string) => {
    setSavingId(id);
    setSaveError(null);
    try {
      let payload: Parameters<typeof api.awaazLabel>[1] = { corrected_text: corrected };
      if (pendingAudio?.utteranceId === id) {
        const utteranceLang = items?.find((item) => item.id === id)?.lang ?? lang;
        const sha256 = pendingAudio.sha256 ?? await sha256Blob(pendingAudio.blob);
        const targetText = pendingAudio.targetText ?? corrected;
        if (targetText !== corrected) throw new Error("Local audio label changed");
        if (!pendingAudio.savedLocally) {
          await saveLocalAudioPair({
            capture_id: pendingAudio.captureId,
            patient_id: patientId,
            source: "caregiver_review",
            utterance_id: id,
            target_text: corrected,
            lang: utteranceLang,
            duration_seconds: pendingAudio.durationSeconds,
            sha256,
            created_at: new Date().toISOString(),
            audio: pendingAudio.blob,
          });
          setPendingAudio((current) => current ? {
            ...current, sha256, targetText: corrected, savedLocally: true,
          } : current);
        }
        payload = {
          corrected_text: corrected,
          audio_capture_id: pendingAudio.captureId,
          audio_duration_seconds: pendingAudio.durationSeconds,
          audio_sha256: sha256,
          audio_size_bytes: pendingAudio.blob.size,
          audio_capture_consent: true,
        };
      }
      await api.awaazLabel(id, payload);
      editRequestRef.current = null;
      setEditing(null);
      setDraft("");
      setPendingAudio(null);
      setAudioConsent(false);
      setAudioStatus(null);
      setSavedCount((n) => n + 1);
      setItems((prev) => (prev ?? []).filter((i) => i.id !== id));
    } catch {
      // Keep the item and the draft. A failed label is a retry, never a training pair.
      setSaveError(COPY.failed[lang]);
    } finally {
      setSavingId(null);
    }
  }, [items, lang, patientId, pendingAudio]);

  if (error) return <AppShell><ErrorState message={error} onRetry={load} /></AppShell>;
  if (!items) return <AppShell><LoadingState /></AppShell>;

  return (
    <AppShell>
      <div className="flex w-full flex-col gap-5">
        <PageHeader
          className="mb-0"
          eyebrow={COPY.eyebrow[lang]}
          title={COPY.title[lang]}
          subtitle={COPY.intro[lang]}
        />

        {savedCount > 0 && (
          <p className="rounded-xl border border-stable/40 bg-stable-soft p-4 text-sm">
            {COPY.done[lang]}
          </p>
        )}

        {saveError && (
          <p role="alert" className="rounded-xl border border-alert/40 bg-alert-soft p-4 text-sm text-alert">
            {saveError}
          </p>
        )}

        {items.length === 0 ? (
          <p className="rounded-2xl border border-line p-6 text-center text-lg">
            {COPY.empty[lang]}
          </p>
        ) : (
          items.map((item) => (
            <article key={item.id} className="rounded-2xl border border-line p-5">
              <p className="text-xs text-muted-foreground">{COPY.heard[lang]}</p>
              <p className="mt-1 text-2xl leading-snug">{item.text}</p>

              {editing === item.id ? (
                <div className="mt-4 flex flex-col gap-3">
                  <label className="text-xs text-muted-foreground">{COPY.meant[lang]}</label>
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={savingId === item.id || pendingAudio?.savedLocally}
                    className="min-h-14 rounded-xl border border-line px-4 text-xl"
                  />
                  {pendingAudio?.savedLocally && (
                    <p className="text-xs text-muted-foreground">{COPY.labelLocked[lang]}</p>
                  )}

                  <section className="rounded-xl border border-line bg-secondary/40 p-4">
                    <h2 className="font-medium">{COPY.audioTitle[lang]}</h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {COPY.audioHelp[lang]}
                    </p>
                    <label className="mt-3 flex min-h-11 items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={audioConsent}
                        disabled={Boolean(pendingAudio) || recordingId === item.id}
                        onChange={(event) => setAudioConsent(event.target.checked)}
                        className="mt-1 h-5 w-5"
                      />
                      <span>{COPY.audioConsent[lang]}</span>
                    </label>

                    {audioConsent && !pendingAudio && (
                      <button
                        type="button"
                        onClick={() => recordingId === item.id
                          ? void stopRecording()
                          : void startRecording(item.id)}
                        className="mt-3 min-h-12 w-full rounded-xl border-2 border-accent/40 px-4"
                      >
                        {recordingId === item.id ? COPY.stop[lang] : COPY.record[lang]}
                      </button>
                    )}

                    {pendingAudio?.utteranceId === item.id && (
                      <div className="mt-3">
                        {previewUrl && <audio controls src={previewUrl} className="w-full" />}
                        <button
                          type="button"
                          onClick={() => void discardAudio()}
                          className="mt-2 min-h-11 w-full rounded-xl border border-alert/40 px-4 text-sm text-alert"
                        >
                          {COPY.discard[lang]}
                        </button>
                      </div>
                    )}
                    {audioStatus && (
                      <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
                        {audioStatus}
                      </p>
                    )}
                  </section>
                  <div className="flex gap-2">
                    <Button
                      className="min-h-12 flex-1"
                      disabled={!draft.trim() || savingId === item.id || recordingId === item.id}
                      onClick={() => void submit(item.id, draft.trim())}
                    >
                      {COPY.save[lang]}
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        editRequestRef.current = null;
                        void discardAudio().finally(() => {
                          setEditing(null);
                          setDraft("");
                        });
                      }}
                      disabled={savingId === item.id}
                      className="min-h-12 rounded-xl border border-line px-4 text-sm"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    disabled={savingId === item.id || editing !== null}
                    onClick={() => void beginEdit(item)}
                    className="min-h-12 flex-1 rounded-xl border-2 border-accent/40 px-4 text-base"
                  >
                    {COPY.correct[lang]}
                  </button>
                  {/* "That was right" is also a verified text label and clears the item. */}
                  <button
                    type="button"
                    disabled={savingId === item.id || editing !== null}
                    onClick={() => void submit(item.id, item.text)}
                    className="min-h-12 flex-1 rounded-xl border border-line px-4 text-base"
                  >
                    {COPY.right[lang]}
                  </button>
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </AppShell>
  );
}

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
 * logs a tap as a confirmed communication event. An explicitly-consented practice mode can
 * also pair a local WAV with that exact tap; only its metadata receipt reaches the server.
 */
import {
  Accessibility,
  AlertTriangle,
  Bath,
  Check,
  CircleCheck,
  Download,
  Gauge,
  GlassWater,
  Hand,
  HeartPulse,
  MessageSquare,
  Mic,
  Phone,
  PhoneCall,
  Square,
  Timer,
  Trash2,
  Users,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useParams } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { confirmedCandidatePayload, emergencyPhrase } from "@/lib/awaaz";
import {
  countLocalAudioPairs,
  deleteLocalAudioPair,
  listLocalAudioPairs,
  listLocalAudioPairIds,
  saveLocalAudioPair,
  sha256Blob,
} from "@/lib/awaazAudioVault";
import {
  buildLocalTrainingArchive,
  trainingArchiveFilename,
} from "@/lib/awaazTrainingExport";
import {
  deleteLocalEmergencyAudio,
  getLocalEmergencyAudio,
  isEmergencyAudioCurrent,
  saveLocalEmergencyAudio,
  startEmergencyPlayback,
  type LocalEmergencyAudio,
} from "@/lib/awaazEmergencyAudio";
import {
  EMERGENCY_LONG_PRESS_MS,
  INDIA_EMERGENCY_DIAL_HREF,
  getEmergencyLocation,
  isEmergencyHoldTarget,
  movedBeyondEmergencyHold,
  readEmergencyLocationConsent,
  writeEmergencyLocationConsent,
  type EmergencyLocation,
  type PointerPoint,
} from "@/lib/awaazEmergency";
import {
  advanceEndpoint,
  startEndpointState,
  type EndpointState,
} from "@/lib/awaazCapture";
import { useI18n } from "@/lib/i18n";
import {
  startAudioRecording,
  wavDurationSeconds,
  type AudioRecorder,
} from "@/lib/recording";
import type { AwaazBoard, AwaazSpeakResult } from "@/lib/types";

interface PendingCapture {
  id: string;
  blob: Blob;
  durationSeconds: number;
  /** Locked after the first pairing attempt so a retry cannot silently change its label. */
  cardId?: string;
  targetText?: string;
  cardLang?: string;
}

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

function EmergencyDialLink() {
  const { t } = useI18n();
  return (
    <a
      href={INDIA_EMERGENCY_DIAL_HREF}
      className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-alert bg-alert-soft px-4 text-base font-semibold text-alert focus-ring"
    >
      <PhoneCall className="h-5 w-5" aria-hidden />
      {t("awaazEmergencyCall108")}
    </a>
  );
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
  const [emergencyDeliveryStatus, setEmergencyDeliveryStatus] = useState<string | null>(null);
  const [captureConsent, setCaptureConsent] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const [pendingCapture, setPendingCapture] = useState<PendingCapture | null>(null);
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [autoStop, setAutoStop] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState(2.5);
  const [localPairCount, setLocalPairCount] = useState(0);
  const [exportConsent, setExportConsent] = useState(false);
  const [exportingPairs, setExportingPairs] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [emergencyAudio, setEmergencyAudio] = useState<LocalEmergencyAudio | null>(null);
  const [emergencyAudioUrl, setEmergencyAudioUrl] = useState<string | null>(null);
  const [isEmergencyRecording, setIsEmergencyRecording] = useState(false);
  const [emergencySelfTestPassed, setEmergencySelfTestPassed] = useState(false);
  const [emergencySetupStatus, setEmergencySetupStatus] = useState<string | null>(null);
  const [shareEmergencyLocation, setShareEmergencyLocation] = useState(false);
  const [emergencyLocation, setEmergencyLocation] = useState<EmergencyLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [longPressArmed, setLongPressArmed] = useState(false);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const emergencyRecorderRef = useRef<AudioRecorder | null>(null);
  const emergencyStopTimerRef = useRef<number | null>(null);
  const endpointRef = useRef<EndpointState | null>(null);
  const meterTimerRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);
  const emergencyStoppingRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<PointerPoint | null>(null);

  const currentBoard = board?.patient_id === patientId ? board : null;
  const currentEmergencyAudio = emergencyAudio?.patient_id === patientId
    ? emergencyAudio
    : null;
  const emergencyText = currentBoard
    ? emergencyPhrase(currentBoard, lang)
    : (currentEmergencyAudio?.target_text ?? emergencyPhrase(null, lang));
  const emergencyCard = currentBoard?.cards.find((card) => card.is_emergency);
  const emergencyLang = emergencyCard?.lang ?? currentEmergencyAudio?.lang ?? lang;
  const emergencyAudioReady = Boolean(
    emergencyAudioUrl
    && isEmergencyAudioCurrent(
      currentEmergencyAudio, patientId, emergencyText, emergencyLang,
    ),
  );

  useEffect(() => {
    let live = true;
    api.awaazBoard(patientId)
      .then((b) => {
        if (!live) return;
        setBoard(b);
        setEndpointDraft(b.profile.endpoint_silence_seconds);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [patientId]);

  useEffect(() => {
    setShareEmergencyLocation(readEmergencyLocationConsent(patientId));
    setEmergencyLocation(null);
    setLocationStatus(null);
  }, [patientId]);

  useEffect(() => {
    void countLocalAudioPairs(patientId)
      .then(setLocalPairCount)
      .catch(() => setLocalPairCount(0));
  }, [patientId]);

  useEffect(() => {
    let live = true;
    void getLocalEmergencyAudio(patientId)
      .then((phrase) => {
        if (!live) return;
        setEmergencyAudio(phrase);
        setEmergencySelfTestPassed(Boolean(phrase?.last_tested_at));
      })
      .catch(() => {
        if (!live) return;
        setEmergencyAudio(null);
        setEmergencySelfTestPassed(false);
      });
    return () => { live = false; };
  }, [patientId]);

  useEffect(() => {
    if (!emergencyAudio) {
      setEmergencyAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(emergencyAudio.audio);
    setEmergencyAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [emergencyAudio]);

  useEffect(() => {
    if (!pendingCapture) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingCapture.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingCapture]);

  useEffect(() => () => {
    if (meterTimerRef.current !== null) window.clearInterval(meterTimerRef.current);
    if (emergencyStopTimerRef.current !== null) {
      window.clearTimeout(emergencyStopTimerRef.current);
    }
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    recorderRef.current?.cancel();
    emergencyRecorderRef.current?.cancel();
  }, []);

  const clearMeterTimer = useCallback(() => {
    if (meterTimerRef.current !== null) {
      window.clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
  }, []);

  const stopCapture = useCallback(async () => {
    if (stoppingRef.current || !recorderRef.current) return;
    stoppingRef.current = true;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    clearMeterTimer();
    setIsRecording(false);
    setRecordingLevel(0);
    try {
      const blob = await recorder.stop();
      const durationSeconds = wavDurationSeconds(blob);
      if (durationSeconds < 0.25) throw new Error("Recording was too short");
      setPendingCapture({
        id: crypto.randomUUID(), blob, durationSeconds,
      });
      setCaptureStatus(null);
    } catch {
      setActionError(t("awaazMicUnavailable"));
    } finally {
      stoppingRef.current = false;
    }
  }, [clearMeterTimer, t]);

  const startCapture = useCallback(async () => {
    if (
      !captureConsent || pendingCapture || recorderRef.current || emergencyRecorderRef.current
    ) return;
    setActionError(null);
    setCaptureStatus(null);
    try {
      const recorder = await startAudioRecording();
      recorderRef.current = recorder;
      endpointRef.current = startEndpointState(performance.now());
      setIsRecording(true);
      meterTimerRef.current = window.setInterval(() => {
        const level = recorder.level();
        setRecordingLevel(level);
        const current = endpointRef.current;
        if (!current) return;
        const update = advanceEndpoint(
          current, level, performance.now(), endpointDraft,
        );
        endpointRef.current = update.state;
        if (update.shouldStop && (update.reason === "maximum" || autoStop)) {
          void stopCapture();
        }
      }, 100);
    } catch {
      setActionError(t("awaazMicUnavailable"));
    }
  }, [autoStop, captureConsent, endpointDraft, pendingCapture, stopCapture, t]);

  const discardCapture = useCallback(async () => {
    if (!pendingCapture) return;
    await deleteLocalAudioPair(pendingCapture.id).catch(() => undefined);
    setPendingCapture(null);
    setCaptureStatus(null);
  }, [pendingCapture]);

  const speakCard = useCallback(async (cardId: string, text: string, cardLang: string) => {
    setActionError(null);
    voice(text, cardLang); // voiced immediately — the patient chose these exact words
    setLastSpoken(text);
    if (pendingCapture) {
      if (pendingCapture.cardId && pendingCapture.cardId !== cardId) {
        setActionError(t("awaazCaptureFailed"));
        return;
      }
      const lockedCapture: PendingCapture = {
        ...pendingCapture, cardId, targetText: text, cardLang,
      };
      setPendingCapture(lockedCapture);
      setBusy(true);
      try {
        const sha256 = await sha256Blob(lockedCapture.blob);
        await saveLocalAudioPair({
          capture_id: lockedCapture.id,
          patient_id: patientId,
          source: "card_tap",
          card_id: cardId,
          target_text: text,
          lang: cardLang,
          duration_seconds: lockedCapture.durationSeconds,
          sha256,
          created_at: new Date().toISOString(),
          audio: lockedCapture.blob,
        });
        const result = await api.awaazSpeak(patientId, {
          card_id: cardId,
          lang: cardLang,
          audio_capture_id: lockedCapture.id,
          audio_duration_seconds: lockedCapture.durationSeconds,
          audio_sha256: sha256,
          audio_size_bytes: lockedCapture.blob.size,
          audio_capture_consent: true,
        });
        if (!result.audio_pair_registered) throw new Error("Pair was not registered");
        setPendingCapture(null);
        setCaptureStatus(t("awaazCaptureSaved"));
        setLocalPairCount((count) => count + 1);
      } catch {
        // Keep both the capture and its locked target so the same idempotent request can
        // be retried after a lost response without changing the label.
        setActionError(t("awaazCaptureFailed"));
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      await api.awaazSpeak(patientId, { card_id: cardId, lang: cardLang });
    } catch {
      // Communication still works locally, but never claim its audit record was saved.
      setActionError(t("awaazNotSaved"));
    }
  }, [patientId, pendingCapture, t]);

  const saveEndpoint = useCallback(async () => {
    setActionError(null);
    try {
      const profile = await api.awaazUpdateProfile(patientId, {
        endpoint_silence_seconds: endpointDraft,
      });
      setBoard((current) => current ? { ...current, profile } : current);
      setCaptureStatus(t("awaazPauseSaved"));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("awaazNotSaved"));
    }
  }, [endpointDraft, patientId, t]);

  const deleteAllRecordings = useCallback(async () => {
    if (!window.confirm(t("awaazDeleteConfirm"))) return;
    setActionError(null);
    const captureIds = await listLocalAudioPairIds(patientId).catch(() => []);
    await Promise.all(captureIds.map(deleteLocalAudioPair));
    setLocalPairCount(0);
    setExportConsent(false);
    setExportStatus(null);
    setPendingCapture(null);
    const receipts = await Promise.allSettled(
      captureIds.map((captureId) => api.awaazDeleteAudioPair(captureId)),
    );
    if (receipts.some((result) => result.status === "rejected")) {
      setActionError(t("awaazDeleteReceiptFailed"));
    } else {
      setCaptureStatus(t("awaazDeleteDone"));
    }
  }, [patientId, t]);

  const exportTrainingPairs = useCallback(async () => {
    if (!exportConsent || exportingPairs) return;
    setActionError(null);
    setExportStatus(null);
    setExportingPairs(true);
    try {
      const pairs = await listLocalAudioPairs(patientId);
      const createdAt = new Date();
      const archive = await buildLocalTrainingArchive(pairs, createdAt);
      const url = URL.createObjectURL(archive);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = trainingArchiveFilename(patientId, createdAt);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setExportConsent(false);
      setExportStatus(t("awaazExportDone"));
    } catch {
      setActionError(t("awaazExportFailed"));
    } finally {
      setExportingPairs(false);
    }
  }, [exportConsent, exportingPairs, patientId, t]);

  const stopEmergencyRecording = useCallback(async () => {
    if (emergencyStoppingRef.current || !emergencyRecorderRef.current) return;
    emergencyStoppingRef.current = true;
    const recorder = emergencyRecorderRef.current;
    emergencyRecorderRef.current = null;
    if (emergencyStopTimerRef.current !== null) {
      window.clearTimeout(emergencyStopTimerRef.current);
      emergencyStopTimerRef.current = null;
    }
    setIsEmergencyRecording(false);
    try {
      const blob = await recorder.stop();
      const durationSeconds = wavDurationSeconds(blob);
      if (durationSeconds < 0.4) throw new Error("Recording was too short");
      const phrase: LocalEmergencyAudio = {
        patient_id: patientId,
        target_text: emergencyText,
        lang: emergencyLang,
        duration_seconds: durationSeconds,
        sha256: await sha256Blob(blob),
        created_at: new Date().toISOString(),
        audio: blob,
      };
      await saveLocalEmergencyAudio(phrase);
      setEmergencyAudio(phrase);
      setEmergencySelfTestPassed(false);
      setEmergencySetupStatus(t("awaazEmergencySavedTestNext"));
    } catch {
      setEmergencySetupStatus(t("awaazEmergencySetupFailed"));
    } finally {
      emergencyStoppingRef.current = false;
    }
  }, [emergencyLang, emergencyText, patientId, t]);

  const startEmergencyRecording = useCallback(async () => {
    if (emergencyRecorderRef.current || recorderRef.current || pendingCapture) return;
    setActionError(null);
    setEmergencySetupStatus(null);
    try {
      emergencyRecorderRef.current = await startAudioRecording();
      setIsEmergencyRecording(true);
      // A fixed phrase should be short, but give dysarthric speakers ample time. This cap
      // prevents an accidentally abandoned microphone session from recording indefinitely.
      emergencyStopTimerRef.current = window.setTimeout(
        () => void stopEmergencyRecording(),
        15_000,
      );
    } catch {
      setEmergencySetupStatus(t("awaazMicUnavailable"));
    }
  }, [pendingCapture, stopEmergencyRecording, t]);

  const testEmergencyAudio = useCallback(async () => {
    if (!emergencyAudioUrl || !isEmergencyAudioCurrent(
      emergencyAudio, patientId, emergencyText, emergencyLang,
    )) {
      setEmergencySetupStatus(t("awaazEmergencyNeedsSetup"));
      return;
    }
    const started = await startEmergencyPlayback(new Audio(emergencyAudioUrl));
    if (!started) {
      setEmergencySetupStatus(t("awaazEmergencyTestFailed"));
      return;
    }
    const tested = { ...emergencyAudio, last_tested_at: new Date().toISOString() };
    await saveLocalEmergencyAudio(tested).catch(() => undefined);
    setEmergencySelfTestPassed(true);
    setEmergencySetupStatus(t("awaazEmergencyTestPassed"));
  }, [emergencyAudio, emergencyAudioUrl, emergencyLang, emergencyText, patientId, t]);

  const removeEmergencyAudio = useCallback(async () => {
    if (!window.confirm(t("awaazEmergencyDeleteConfirm"))) return;
    try {
      await deleteLocalEmergencyAudio(patientId);
      setEmergencyAudio(null);
      setEmergencySelfTestPassed(false);
      setEmergencySetupStatus(t("awaazEmergencyDeleted"));
    } catch {
      setEmergencySetupStatus(t("awaazEmergencySetupFailed"));
    }
  }, [patientId, t]);

  const updateLocationSharing = useCallback(async (enabled: boolean) => {
    setShareEmergencyLocation(enabled);
    writeEmergencyLocationConsent(patientId, enabled);
    setEmergencyLocation(null);
    if (!enabled) {
      setLocationStatus(t("awaazEmergencyLocationOff"));
      return;
    }
    setLocationStatus(t("awaazEmergencyLocationRequesting"));
    const location = await getEmergencyLocation();
    setEmergencyLocation(location);
    setLocationStatus(location
      ? t("awaazEmergencyLocationReady")
      : t("awaazEmergencyLocationUnavailable"));
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
    // Start the on-device WAV before touching the network. A stock browser voice is only a
    // visible fallback and is never counted as offline-capable because browsers may fetch
    // voices from the network.
    let offlineAudioPlayed = false;
    if (emergencyAudioReady && emergencyAudioUrl) {
      offlineAudioPlayed = await startEmergencyPlayback(new Audio(emergencyAudioUrl));
    }
    if (!offlineAudioPlayed) voice(emergencyText, emergencyLang);
    setLastSpoken(emergencyText);
    setEmergencyWarning(null);
    setEmergencyDeliveryStatus(null);
    let location = emergencyLocation;
    if (shareEmergencyLocation && !location) {
      // Never let a slow GPS fix hold the alert for long. The local phrase has already
      // started; after 1.5 seconds the request proceeds without coordinates.
      location = await getEmergencyLocation(1_500);
      if (location) setEmergencyLocation(location);
    }
    try {
      const result = await api.awaazEmergency(patientId, {
        event_id: crypto.randomUUID(),
        offline_audio_played: offlineAudioPlayed,
        location_consent: shareEmergencyLocation,
        ...(location ? {
          lat: location.lat,
          lon: location.lon,
          location_accuracy_m: location.accuracy_m,
        } : {}),
      });
      const warnings = [
        ...(!result.works_offline ? [t("awaazEmergencyOfflineMissing")] : []),
        ...(!result.caregiver_notified ? [t("awaazEmergencyDeliveryMissing")] : []),
      ];
      setEmergencyWarning(warnings.length ? warnings.join(" ") : null);
      setEmergencyDeliveryStatus(result.caregiver_notified
        ? t("awaazEmergencyDelivered")
        : null);
    } catch {
      const warnings = [
        ...(!offlineAudioPlayed ? [t("awaazEmergencyOfflineMissing")] : []),
        t("awaazEmergencyDeliveryMissing"),
      ];
      setEmergencyWarning(warnings.join(" "));
      setEmergencyDeliveryStatus(null);
    }
  }, [
    emergencyAudioReady,
    emergencyAudioUrl,
    emergencyLang,
    emergencyLocation,
    emergencyText,
    patientId,
    shareEmergencyLocation,
    t,
  ]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
    setLongPressArmed(false);
  }, []);

  const beginLongPress = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || !isEmergencyHoldTarget(event.target)) return;
    cancelLongPress();
    longPressOriginRef.current = { x: event.clientX, y: event.clientY };
    setLongPressArmed(true);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressOriginRef.current = null;
      setLongPressArmed(false);
      try { navigator.vibrate?.(80); } catch { /* vibration is best effort */ }
      void emergency();
    }, EMERGENCY_LONG_PRESS_MS);
  }, [cancelLongPress, emergency]);

  const moveLongPress = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = longPressOriginRef.current;
    if (origin && movedBeyondEmergencyHold(origin, { x: event.clientX, y: event.clientY })) {
      cancelLongPress();
    }
  }, [cancelLongPress]);

  const suppressHoldMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (longPressArmed && isEmergencyHoldTarget(event.target)) event.preventDefault();
  }, [longPressArmed]);

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

  if (error && !currentBoard) {
    return (
      <AppShell>
        <div
          className="mx-auto flex max-w-xl flex-col gap-4"
          onPointerDown={beginLongPress}
          onPointerMove={moveLongPress}
          onPointerUp={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onContextMenu={suppressHoldMenu}
        >
          <button
            type="button"
            onClick={() => void emergency()}
            className="flex min-h-24 items-center justify-center gap-3 rounded-2xl bg-alert px-4 text-2xl font-semibold text-white"
          >
            <AlertTriangle className="h-8 w-8" aria-hidden /> {emergencyText}
          </button>
          <EmergencyDialLink />
          <p className="-mt-2 text-center text-xs text-muted-foreground">
            {longPressArmed ? t("awaazEmergencyHolding") : t("awaazEmergencyHoldHint")}
          </p>
          <p className="rounded-xl border border-line bg-secondary p-4 text-sm">
            {emergencyAudioReady
              ? t("awaazEmergencyOfflineReady")
              : t("awaazEmergencyOfflineMissing")}
          </p>
          {lastSpoken && (
            <p className="flex items-center gap-2 rounded-xl border border-line p-4 text-xl">
              <Volume2 className="h-6 w-6 shrink-0 text-accent" aria-hidden />
              <span aria-live="polite">{lastSpoken}</span>
            </p>
          )}
          {emergencyWarning && (
            <p role="alert" className="rounded-xl border border-alert/40 bg-alert-soft p-4 text-alert">
              {emergencyWarning}
            </p>
          )}
          {emergencyDeliveryStatus && (
            <p aria-live="polite" className="rounded-xl border border-stable/40 bg-stable-soft p-4">
              {emergencyDeliveryStatus}
            </p>
          )}
          <ErrorState message={t("awaazBoardOfflineUnavailable")} />
        </div>
      </AppShell>
    );
  }
  if (!currentBoard) return <AppShell><LoadingState /></AppShell>;

  const isAphasia = currentBoard.profile.speech_profile !== "dysarthria_dominant";

  return (
    <AppShell>
      <div
        className="mx-auto flex max-w-xl flex-col gap-5"
        onPointerDown={beginLongPress}
        onPointerMove={moveLongPress}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onContextMenu={suppressHoldMenu}
      >
        {/* Emergency is first, biggest, and always the same place. */}
        <button
          type="button"
          onClick={() => void emergency()}
          className="flex min-h-20 items-center justify-center gap-3 rounded-2xl bg-alert text-2xl font-semibold text-white"
        >
          <AlertTriangle className="h-8 w-8" aria-hidden /> {emergencyText}
        </button>
        <EmergencyDialLink />
        <p className="-mt-3 text-center text-xs text-muted-foreground">
          {longPressArmed ? t("awaazEmergencyHolding") : t("awaazEmergencyHoldHint")}
        </p>

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

        {emergencyDeliveryStatus && (
          <p aria-live="polite" className="rounded-xl border border-stable/40 bg-stable-soft p-4 text-base">
            {emergencyDeliveryStatus}
          </p>
        )}

        {actionError && (
          <p role="alert" className="rounded-xl border border-alert/40 bg-alert-soft p-4 text-base text-alert">
            {actionError}
          </p>
        )}

        {captureStatus && (
          <p aria-live="polite" className="rounded-xl border border-stable/40 bg-stable-soft p-4 text-sm">
            {captureStatus}
          </p>
        )}

        <details className="rounded-2xl border-2 border-accent/20 bg-secondary/40 p-4">
          <summary className="flex cursor-pointer list-none items-start gap-3">
            <Mic className="mt-1 h-6 w-6 shrink-0 text-accent" aria-hidden />
            <span>
              <span className="block text-lg font-semibold">{t("awaazPracticeTitle")}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{t("awaazPracticeIntro")}</span>
            </span>
          </summary>

          <label className="mt-4 flex min-h-12 items-start gap-3 rounded-xl border border-line bg-card p-3 text-sm">
            <input
              type="checkbox"
              checked={captureConsent}
              disabled={isRecording || Boolean(pendingCapture)}
              onChange={(event) => setCaptureConsent(event.target.checked)}
              className="mt-1 h-5 w-5 accent-accent"
            />
            <span>{t("awaazCaptureConsent")}</span>
          </label>

          <div className="mt-4 rounded-xl border border-line bg-card p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-accent" aria-hidden />
                {t("awaazPauseLabel")}
              </span>
              <strong>{endpointDraft.toFixed(1)}s</strong>
            </div>
            <input
              type="range"
              min="0.5"
              max="4"
              step="0.5"
              value={endpointDraft}
              disabled={isRecording}
              aria-label={t("awaazPauseLabel")}
              onChange={(event) => setEndpointDraft(Number(event.target.value))}
              className="mt-3 w-full accent-accent"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoStop}
                  disabled={isRecording}
                  onChange={(event) => setAutoStop(event.target.checked)}
                  className="h-5 w-5 accent-accent"
                />
                {t("awaazAutoStop")}
              </label>
              <button
                type="button"
                disabled={isRecording || endpointDraft === currentBoard.profile.endpoint_silence_seconds}
                onClick={() => void saveEndpoint()}
                className="min-h-11 rounded-lg border border-line px-3 text-sm disabled:opacity-50"
              >
                {t("awaazSavePause")}
              </button>
            </div>
          </div>

          {isRecording && (
            <div className="mt-4" aria-live="polite">
              <div
                role="progressbar"
                aria-label="Microphone level"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(Math.min(100, recordingLevel * 400))}
                className="h-3 overflow-hidden rounded-full bg-line"
              >
                <div
                  className="h-full bg-accent transition-[width] duration-100"
                  style={{ width: `${Math.min(100, recordingLevel * 400)}%` }}
                />
              </div>
            </div>
          )}

          <Button
            type="button"
            size="touch"
            variant={isRecording ? "destructive" : "accent"}
            disabled={!isRecording && (
              !captureConsent || Boolean(pendingCapture) || busy || isEmergencyRecording
            )}
            onClick={() => void (isRecording ? stopCapture() : startCapture())}
            className="mt-4"
          >
            {isRecording
              ? <><Square className="h-6 w-6" aria-hidden /> {t("awaazStopRecording")}</>
              : <><Mic className="h-6 w-6" aria-hidden /> {t("awaazStartRecording")}</>}
          </Button>

          {pendingCapture && (
            <div className="mt-4 rounded-xl border-2 border-accent/40 bg-card p-4">
              <p className="font-medium">{t("awaazChoosePhrase")}</p>
              {previewUrl && <audio controls src={previewUrl} className="mt-3 w-full" />}
              <div className="mt-3 grid grid-cols-2 gap-2">
                {currentBoard.cards.filter((card) => !card.is_emergency).map((card) => (
                  <button
                    key={`pair-${card.id}`}
                    type="button"
                    disabled={busy}
                    onClick={() => void speakCard(card.id, card.text, card.lang)}
                    className="min-h-14 rounded-xl border border-line px-3 text-left text-base disabled:opacity-50"
                  >
                    {card.text}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void discardCapture()}
                className="mt-3 min-h-11 text-sm text-alert underline"
              >
                {t("awaazDiscardRecording")}
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs text-muted-foreground">
            <span><strong className="text-foreground">{localPairCount}</strong> {t("awaazLocalPairs")}</span>
            {localPairCount > 0 && (
              <button
                type="button"
                onClick={() => void deleteAllRecordings()}
                className="flex min-h-10 items-center gap-2 text-alert underline"
              >
                <Trash2 className="h-4 w-4" aria-hidden /> {t("awaazDeleteRecordings")}
              </button>
            )}
          </div>
          {localPairCount > 0 && (
            <div className="mt-3 rounded-xl border border-alert/30 bg-alert-soft/30 p-3">
              <p className="text-sm font-medium">{t("awaazExportTitle")}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("awaazExportHelp")}
              </p>
              <label className="mt-3 flex min-h-11 items-start gap-3 text-xs">
                <input
                  type="checkbox"
                  checked={exportConsent}
                  disabled={exportingPairs}
                  onChange={(event) => setExportConsent(event.target.checked)}
                  className="mt-0.5 h-5 w-5 accent-accent"
                />
                <span>{t("awaazExportConsent")}</span>
              </label>
              <button
                type="button"
                disabled={!exportConsent || exportingPairs}
                onClick={() => void exportTrainingPairs()}
                className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-line bg-card px-3 text-sm disabled:opacity-50"
              >
                <Download className="h-4 w-4" aria-hidden />
                {exportingPairs ? t("awaazExporting") : t("awaazExportButton")}
              </button>
              {exportStatus && (
                <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
                  {exportStatus}
                </p>
              )}
            </div>
          )}
        </details>

        <div className="grid grid-cols-2 gap-3">
          {currentBoard.cards.filter((card) => !card.is_emergency).map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => void speakCard(c.id, c.text, c.lang)}
              className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-line p-3 text-xl active:border-accent disabled:opacity-50"
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
          <details className="rounded-xl border border-line p-3">
            <summary className="flex cursor-pointer list-none items-start gap-3">
              <Volume2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
              <span>
                <span className="block text-sm font-semibold">{t("awaazEmergencySetupTitle")}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {emergencyAudioReady
                    ? t("awaazEmergencyReady")
                    : t("awaazEmergencyNeedsSetup")}
                </span>
              </span>
            </summary>

            <p className="mt-3 text-sm text-muted-foreground">
              {t("awaazEmergencySetupIntro")}
            </p>
            <p className="mt-2 rounded-lg bg-secondary p-3 text-lg font-medium">
              “{emergencyText}”
            </p>

            <label className="mt-3 flex min-h-12 items-start gap-3 rounded-lg border border-line p-3 text-sm">
              <input
                type="checkbox"
                checked={shareEmergencyLocation}
                onChange={(event) => void updateLocationSharing(event.target.checked)}
                className="mt-0.5 h-5 w-5 accent-accent"
              />
              <span>
                <span className="block font-medium">{t("awaazEmergencyLocationLabel")}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t("awaazEmergencyLocationHelp")}
                </span>
              </span>
            </label>
            {locationStatus && (
              <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
                {locationStatus}
              </p>
            )}

            {emergencyAudioReady && (
              <p className="mt-3 text-xs text-muted-foreground">
                {emergencySelfTestPassed
                  ? t("awaazEmergencyTestRecorded")
                  : t("awaazEmergencyNotTested")}
              </p>
            )}

            {emergencySetupStatus && (
              <p aria-live="polite" className="mt-3 rounded-lg border border-line bg-secondary p-3 text-sm">
                {emergencySetupStatus}
              </p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy || isRecording || Boolean(pendingCapture)}
                onClick={() => void (
                  isEmergencyRecording ? stopEmergencyRecording() : startEmergencyRecording()
                )}
                className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm disabled:opacity-50"
              >
                {isEmergencyRecording
                  ? <><Square className="h-4 w-4" aria-hidden /> {t("awaazStopRecording")}</>
                  : <><Mic className="h-4 w-4" aria-hidden /> {emergencyAudioReady
                    ? t("awaazEmergencyRerecord")
                    : t("awaazEmergencyRecord")}</>}
              </button>
              <button
                type="button"
                disabled={!emergencyAudioReady || isEmergencyRecording}
                onClick={() => void testEmergencyAudio()}
                className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm disabled:opacity-50"
              >
                <Volume2 className="h-4 w-4" aria-hidden /> {t("awaazEmergencyTest")}
              </button>
            </div>

            {emergencyAudio && (
              <button
                type="button"
                disabled={isEmergencyRecording}
                onClick={() => void removeEmergencyAudio()}
                className="mt-2 flex min-h-10 items-center gap-2 text-xs text-alert underline disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden /> {t("awaazEmergencyDelete")}
              </button>
            )}
          </details>
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

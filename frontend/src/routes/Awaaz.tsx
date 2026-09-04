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
 *
 * HOW THE SCREEN IS ARRANGED, and why it is not one flat stack
 * ------------------------------------------------------------
 * Two zones with different owners. The SPEAKING SURFACE — emergency, the utterance plate,
 * the board, type-to-speak — belongs to the patient and carries `.patient-scale`: a 20px
 * floor and a 64px tap target, the same contract every other patient screen has. The
 * CAREGIVER ZONE below the rule owns everything that configures the thing: practice
 * capture, phrase management, the offline emergency voice, the listener link, analytics
 * consent. The practice panel used to sit between the emergency control and the board,
 * which put a training feature in the path of somebody trying to ask for the toilet.
 *
 * The UTTERANCE PLATE is the centre of the screen and the one genuinely new surface. A
 * communication board has two readers — the person tapping and the person listening — and
 * before this there was nowhere for the second one to look: what had been said appeared as
 * a 20px line above the fold and scrolled away as soon as the board was used. The plate is
 * sticky, so it stays under the header while the board scrolls beneath it, and it is the
 * largest type on the page, because across a room it is the whole product.
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
  RotateCcw,
  Stethoscope,
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
import { AwaazSpeechDemonstrator } from "@/components/awaaz/AwaazSpeechDemonstrator";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import {
  confirmedCandidatePayload,
  emergencyPhrase,
  getLocalizedCardText,
  personalPhrasePayload,
} from "@/lib/awaaz";
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
import { listenerSharePath, normaliseListenerLanguage } from "@/lib/awaazListener";
import {
  getCachedAwaazBoard,
  mayUseOfflineBoard,
  saveCachedAwaazBoard,
} from "@/lib/awaazOfflineBoard";
import {
  correctedOutcome,
  noExplicitSignalOutcome,
  openPolicySlate,
  phraseBoardFallbackOutcome,
  readPolicyLoggingConsent,
  rejectedOutcome,
  reportPolicyOutcome,
  scoredSlateFromSpeakResult,
  selectedOutcome,
  writePolicyLoggingConsent,
  type PolicyOutcomeReport,
  type PolicySlate,
} from "@/lib/awaazPolicyLog";
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
import { haptic } from "@/lib/haptic";
import { useI18n } from "@/lib/i18n";
import { usePrefs } from "@/lib/prefs";
import { speak, stopSpeaking } from "@/lib/speech-synthesis";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  startAudioRecording,
  wavDurationSeconds,
  type AudioRecorder,
} from "@/lib/recording";
import {
  AWAAZ_SPEECH_PROFILES,
  type AwaazBoard,
  type AwaazProfileUpdate,
  type AwaazSpeakResult,
  type Lang,
} from "@/lib/types";

interface PendingCapture {
  id: string;
  blob: Blob;
  durationSeconds: number;
  /** Locked after the first pairing attempt so a retry cannot silently change its label. */
  cardId?: string;
  targetText?: string;
  cardLang?: string;
}

/** What the utterance plate is showing. `lang` is narrowed so it can pick a real voice. */
interface SpokenPhrase {
  text: string;
  lang: Lang;
  /** Set when the phrase came from a tile, so the board can show which one is speaking. */
  cardId?: string;
}

interface ListenerCapability {
  token: string;
  url: string;
}

/**
 * The assessment, in words a family can act on.
 *
 * Deliberately not "dysarthria" and "aphasia". The person setting this is usually a
 * caregiver acting on a clinician's advice, in Hindi or Punjabi, and the two clinical
 * terms are near-homophones for someone hearing them for the first time — which is a
 * catastrophic thing to get backwards, because one of these profiles is the only one that
 * lets the app speak without being asked. Each option says what is hard, and the line
 * under it says what the board will then do.
 */
const PROFILE_LABEL_KEY = {
  dysarthria_dominant: "awaazProfileDysarthria",
  aphasia_dominant: "awaazProfileAphasia",
  mixed: "awaazProfileMixed",
} as const;

const PROFILE_SUMMARY_KEY = {
  dysarthria_dominant: "awaazProfileDysarthriaHelp",
  aphasia_dominant: "awaazProfileAphasiaHelp",
  mixed: "awaazProfileMixedHelp",
} as const;

/** `unassessed` is reported, never offered: not deciding is a state, not a choice. */
function profileHeadlineKey(profile: string) {
  return PROFILE_LABEL_KEY[profile as keyof typeof PROFILE_LABEL_KEY]
    ?? "awaazProfileUnassessed";
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

/**
 * The icon, on a chip.
 *
 * A bare glyph floating in a bordered rectangle is what made the board read as twelve empty
 * boxes: nothing on the tile had any weight until the text. The chip gives each card an
 * object to be, and it is also the card's speaking state — it inverts rather than a colour
 * appearing somewhere new, because this palette reserves every non-blue for clinical status
 * (index.css) and a phrase card is not a status.
 */
function PhraseIcon({ name, active }: { name: string | null; active?: boolean }) {
  const Icon = (name && CARD_ICONS[name]) || MessageSquare;
  return (
    <span
      className={cn(
        "tactile flex h-12 w-12 items-center justify-center rounded-xl",
        active ? "bg-accent text-accent-foreground" : "bg-secondary text-accent",
      )}
    >
      <Icon className="h-6 w-6" aria-hidden />
    </span>
  );
}

/**
 * The voice indicator: five bars that move only while something is actually being spoken.
 *
 * Driven by the utterance's own `end` event, not by a timer, so it is a readout and not an
 * animation that plays for a while and stops — when the phone has no voice for this
 * language the bars never rise, which is the honest thing for them to do. Reduced motion
 * and the patient's own "less movement" switch both flatten it; the phrase beside it is
 * the information, and the bars are only ever the confirmation.
 */
function VoiceBars({ active }: { active: boolean }) {
  return (
    <span aria-hidden className="flex h-9 items-end gap-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn(
            "w-1.5 rounded-full bg-accent",
            active ? "speak-bar" : "h-1.5 opacity-40",
          )}
          style={active ? { animationDelay: `${i * 110}ms` } : undefined}
        />
      ))}
    </span>
  );
}

function EmergencyDialLink() {
  const { t } = useI18n();
  return (
    <a
      href={INDIA_EMERGENCY_DIAL_HREF}
      className="focus-ring tactile flex min-h-14 flex-1 basis-56 items-center justify-center gap-2 rounded-xl border-2 border-alert bg-alert-soft px-4 text-base font-semibold text-alert"
    >
      <PhoneCall className="h-5 w-5" aria-hidden />
      {t("awaazEmergencyCall108")}
    </a>
  );
}

/**
 * Some engines fire neither `end` nor `error` — older Android WebViews, and Safari after a
 * `cancel()`. Without a ceiling the plate would show a phrase as still being spoken for the
 * rest of the conversation. Roughly fourteen characters a second with a 2.5s floor: long
 * enough for a slow Indic voice reading a whole sentence, short enough that a stuck
 * indicator does not outlive the exchange it belongs to.
 */
function voicingCeilingMs(text: string): number {
  return Math.max(2_500, text.length * 70);
}

/**
 * What is being said, in the one place both people in the conversation can find it.
 *
 * Sticky rather than fixed: it stays in the column, the emergency control above it is still
 * reachable by scrolling back, and it never floats over the board's last row. `top-16` is
 * the app header's own height.
 */
function UtterancePlate({ phrase, voicing, onRepeat }: {
  phrase: SpokenPhrase | null;
  voicing: boolean;
  onRepeat: () => void;
}) {
  const { t } = useI18n();
  return (
    <section
      className={cn(
        "rounded-2xl p-4 sm:p-5",
        // Pinned only once it is holding something. Empty, it would follow the reader down
        // the whole page as a dashed rectangle saying nothing.
        phrase && "sticky top-16 z-10",
        "transition-colors duration-300 [transition-timing-function:var(--ease-out)]",
        // Three states, carried by the surface itself rather than by a status word: an
        // empty plate is recessive and dashed so it reads as a place waiting for
        // something, a held phrase is solid, and a phrase being voiced right now is the
        // strongest thing on the screen. Nothing here needs translating.
        !phrase && "border-2 border-dashed border-line",
        phrase && !voicing && "border-2 border-accent/30 bg-card",
        voicing && "border-2 border-accent bg-secondary",
      )}
    >
      {/* A floor, so the board below does not shift under the patient's finger every time
          a phrase is longer or shorter than the last one. */}
      <div className={cn("flex items-center gap-4", phrase ? "min-h-[4.5rem]" : "min-h-11")}>
        {phrase && <VoiceBars active={voicing} />}
        <p
          aria-live="polite"
          lang={phrase?.lang}
          className="min-w-0 flex-1 break-words leading-tight"
        >
          {phrase ? (
            <span className="text-[clamp(1.75rem,7.5vw,3rem)] font-semibold tracking-[-0.02em]">
              {phrase.text}
            </span>
          ) : (
            <span className="text-base text-muted-foreground">{t("awaazPlateIdle")}</span>
          )}
        </p>
        {phrase && (
          <button
            type="button"
            onClick={onRepeat}
            aria-label={t("awaazSayAgain")}
            className="focus-ring tactile flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 border-line text-accent"
          >
            <RotateCcw className="h-6 w-6" aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}

export default function Awaaz() {
  const { patientId = "" } = useParams();
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [board, setBoard] = useState<AwaazBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usingOfflineBoard, setUsingOfflineBoard] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  // What the plate is showing, and whether a voice is on it right now. Two pieces of state
  // rather than one: the phrase STAYS after the voice finishes, because the listener across
  // the room reads it long after the sound has gone.
  const [spoken, setSpoken] = useState<SpokenPhrase | null>(null);
  const [voicing, setVoicing] = useState(false);
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
  const [thresholdDraft, setThresholdDraft] = useState(0.85);
  const [localPairCount, setLocalPairCount] = useState(0);
  const [exportConsent, setExportConsent] = useState(false);
  const [exportingPairs, setExportingPairs] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [personalPhrase, setPersonalPhrase] = useState("");
  const [phraseBusy, setPhraseBusy] = useState(false);
  const [phraseStatus, setPhraseStatus] = useState<string | null>(null);
  const [emergencyAudio, setEmergencyAudio] = useState<LocalEmergencyAudio | null>(null);
  const [emergencyAudioUrl, setEmergencyAudioUrl] = useState<string | null>(null);
  const [isEmergencyRecording, setIsEmergencyRecording] = useState(false);
  const [emergencySelfTestPassed, setEmergencySelfTestPassed] = useState(false);
  const [emergencySetupStatus, setEmergencySetupStatus] = useState<string | null>(null);
  const [shareEmergencyLocation, setShareEmergencyLocation] = useState(false);
  const [emergencyLocation, setEmergencyLocation] = useState<EmergencyLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [longPressArmed, setLongPressArmed] = useState(false);
  const [policyLoggingConsent, setPolicyLoggingConsent] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [prefs] = usePrefs();
  const recorderRef = useRef<AudioRecorder | null>(null);
  // A re-render must not mint a second "this one is speaking" claim: only the latest
  // utterance may clear the indicator, or a phrase cut off by the next tap would clear the
  // tap that replaced it.
  const voiceTokenRef = useRef(0);
  const voiceCeilingRef = useRef<number | null>(null);
  // False once this screen is gone. `startAudioRecording` can still be awaiting the
  // permission prompt at that point, and the microphone it then hands back would have
  // nothing left to release it — the cleanup below has already run.
  const mountedRef = useRef(true);
  const emergencyRecorderRef = useRef<AudioRecorder | null>(null);
  const emergencyStopTimerRef = useRef<number | null>(null);
  const endpointRef = useRef<EndpointState | null>(null);
  const meterTimerRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);
  const emergencyStoppingRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<PointerPoint | null>(null);
  // The open candidate-ranking event, if one was drawn. A ref rather than state because
  // nothing about it is rendered and a re-render must never mint a second event id for one
  // decision — that would make one decision two observations in every weighted sum.
  const policySlateRef = useRef<PolicySlate | null>(null);
  const policyConsentRef = useRef(false);
  policyConsentRef.current = policyLoggingConsent;

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
    const loadBoard = async () => {
      try {
        const fresh = await api.awaazBoard(patientId, lang);
        if (!live) return;
        setBoard(fresh);
        setEndpointDraft(fresh.profile.endpoint_silence_seconds);
        setThresholdDraft(fresh.profile.auto_speak_threshold);
        setUsingOfflineBoard(false);
        setError(null);
      } catch (loadError) {
        if (!live) return;
        if (user?.id && mayUseOfflineBoard(loadError)) {
          const cached = await getCachedAwaazBoard(user.id, patientId)
            .catch(() => null);
          if (!live) return;
          if (cached) {
            setBoard(cached);
            setEndpointDraft(cached.profile.endpoint_silence_seconds);
            setThresholdDraft(cached.profile.auto_speak_threshold);
            setCandidates([]);
            setUsingOfflineBoard(true);
            setError(null);
            return;
          }
        }
        // An authorization rejection is authoritative. Never keep rendering a board that
        // this identity may no longer access merely because an older snapshot exists.
        setBoard(null);
        setUsingOfflineBoard(false);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    };

    setError(null);
    void loadBoard();
    window.addEventListener("online", loadBoard);
    return () => {
      live = false;
      window.removeEventListener("online", loadBoard);
    };
  }, [lang, patientId, user?.id]);

  useEffect(() => {
    if (!user?.id || !currentBoard || usingOfflineBoard) return;
    // Best effort only: a storage failure must not block the live communication board.
    void saveCachedAwaazBoard(user.id, currentBoard).catch(() => undefined);
  }, [currentBoard, user?.id, usingOfflineBoard]);

  useEffect(() => {
    if (!currentBoard) return;
    const markOffline = () => setUsingOfflineBoard(true);
    window.addEventListener("offline", markOffline);
    return () => window.removeEventListener("offline", markOffline);
  }, [currentBoard]);

  useEffect(() => {
    setShareEmergencyLocation(readEmergencyLocationConsent(patientId));
    setEmergencyLocation(null);
    setLocationStatus(null);
    // A separate consent record per purpose (PRD_AWAAZ §10.2). Analytics logging does not
    // ride on the consent given for anything else, and its default is off.
    setPolicyLoggingConsent(readPolicyLoggingConsent(patientId));
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (meterTimerRef.current !== null) window.clearInterval(meterTimerRef.current);
      if (emergencyStopTimerRef.current !== null) {
        window.clearTimeout(emergencyStopTimerRef.current);
      }
      if (voiceCeilingRef.current !== null) window.clearTimeout(voiceCeilingRef.current);
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
      recorderRef.current?.cancel();
      emergencyRecorderRef.current?.cancel();
      // Leaving mid-phrase must not leave the phone talking over the next screen.
      stopSpeaking();
    };
  }, []);

  /**
   * Speak, and show what is being said.
   *
   * `essential` because the comfort switch this would otherwise obey means "do not read the
   * screen aloud" — on every other surface that is a preference, and here it would mute the
   * patient. Routed through the shared synthesiser rather than a local utterance so this
   * screen gets the same voice selection as the rest of the app: the old local version only
   * set `utterance.lang`, which on most handsets picks the default English voice and reads
   * Gurmukhi with it.
   */
  const say = useCallback((text: string, spokenLang: string, cardId?: string) => {
    const token = voiceTokenRef.current + 1;
    voiceTokenRef.current = token;
    if (voiceCeilingRef.current !== null) window.clearTimeout(voiceCeilingRef.current);
    setSpoken({ text, lang: normaliseListenerLanguage(spokenLang), cardId });
    setVoicing(true);
    const settle = () => {
      if (voiceTokenRef.current === token) setVoicing(false);
    };
    voiceCeilingRef.current = window.setTimeout(settle, voicingCeilingMs(text));
    speak(text, normaliseListenerLanguage(spokenLang), {
      essential: true,
      rate: 0.95,
      onEnd: settle,
    });
  }, []);


  const clearMeterTimer = useCallback(() => {
    if (meterTimerRef.current !== null) {
      window.clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
  }, []);

  const stopCapture = useCallback(async (auto = false) => {
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
      // A take we ended ourselves because the app left the screen can legitimately be too
      // short to keep. Saying "the microphone is unavailable" there would be a false
      // report about the hardware; the status line has already explained what happened.
      if (!auto) setActionError(t("awaazMicUnavailable"));
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
      // The permission prompt can outlive the screen. Nothing else holds a reference to
      // this recorder, so if we are gone it has to close itself here or not at all.
      if (!mountedRef.current) { recorder.cancel(); return; }
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

  /**
   * Nothing may hold the microphone while the app is not on screen.
   *
   * `lib/recording.ts` already releases the hardware itself — that is the guarantee, and it
   * holds for every caller. This is the other half: the UI has to agree with it, or the
   * meter keeps animating and the button keeps saying "Stop" over a microphone that is
   * already closed. A practice take is STOPPED, which keeps whatever was captured; the
   * fixed emergency phrase is CANCELLED, because half of a phrase somebody will rely on in
   * an emergency is worse than none.
   *
   * SPEECH IS DELIBERATELY NOT STOPPED HERE. A screen that dims two seconds after a tap
   * fires this same event, and cutting the phrase off there would silence the patient
   * mid-sentence in front of the person they were talking to. The microphone is a privacy
   * question; the loudspeaker is the product working.
   */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      if (recorderRef.current) {
        setCaptureStatus(t("awaazMicClosed"));
        void stopCapture(true);
      }
      if (emergencyRecorderRef.current) {
        emergencyRecorderRef.current.cancel();
        emergencyRecorderRef.current = null;
        if (emergencyStopTimerRef.current !== null) {
          window.clearTimeout(emergencyStopTimerRef.current);
          emergencyStopTimerRef.current = null;
        }
        setIsEmergencyRecording(false);
        setEmergencySetupStatus(t("awaazMicClosed"));
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [stopCapture, t]);

  const discardCapture = useCallback(async () => {
    if (!pendingCapture) return;
    await deleteLocalAudioPair(pendingCapture.id).catch(() => undefined);
    setPendingCapture(null);
    setCaptureStatus(null);
  }, [pendingCapture]);

  /**
   * Close the open ranking event, if there is one. Fire-and-forget on purpose: a logging
   * report may never delay a tap, hold up speech, or surface an error to a patient who is
   * trying to say something. The ref is cleared first so exactly one outcome is reported.
   */
  const closePolicySlate = useCallback((report: PolicyOutcomeReport) => {
    const slate = policySlateRef.current;
    policySlateRef.current = null;
    if (!slate) return;
    void reportPolicyOutcome(api, patientId, slate, report);
  }, [patientId]);

  // Leaving the screen, or switching patient, having done none of the four is the
  // `no_explicit_signal` case. It is reported rather than dropped, because a log that only
  // exists when the patient reacted is a sample selected on the outcome.
  useEffect(
    () => () => closePolicySlate(noExplicitSignalOutcome()),
    [closePolicySlate],
  );

  const speakCard = useCallback(async (cardId: string, text: string, cardLang: string) => {
    setActionError(null);
    // Reaching for the board while options are on screen is the designed safety route, and
    // the one outcome the ranker most needs to see (D-065).
    closePolicySlate(phraseBoardFallbackOutcome());
    haptic();
    say(text, cardLang, cardId); // voiced immediately — the patient chose these words
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
    if (usingOfflineBoard) {
      setActionError(t("awaazOfflineActivityNotSaved"));
      return;
    }
    try {
      await api.awaazSpeak(patientId, { card_id: cardId, lang: cardLang });
    } catch (saveError) {
      // Communication still works locally, but never claim its audit record was saved.
      if (mayUseOfflineBoard(saveError)) {
        setUsingOfflineBoard(true);
        setActionError(t("awaazOfflineActivityNotSaved"));
      } else {
        setActionError(t("awaazNotSaved"));
      }
    }
  }, [closePolicySlate, patientId, pendingCapture, say, t, usingOfflineBoard]);

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

  /**
   * Record the assessment. INV-9's gate reads this row and nothing else.
   *
   * ONE REQUEST, NEVER TWO. The server refuses `auto_speak_enabled` on a profile that may
   * not auto-speak — with a 409, deliberately, because a setting that looks accepted and
   * silently does nothing is how a family comes to believe the app behaves differently
   * than it does. So moving AWAY from dysarthria carries the switch off in the same patch
   * rather than leaving a contradiction on the wire for the server to reject.
   */
  const saveProfile = useCallback(async (patch: AwaazProfileUpdate) => {
    if (profileBusy) return;
    setProfileBusy(true);
    setProfileStatus(null);
    setActionError(null);
    try {
      const profile = await api.awaazUpdateProfile(patientId, patch);
      setBoard((current) => current?.patient_id === patientId
        ? { ...current, profile }
        : current);
      // The server clamps the threshold at 70%. Take its number back rather than keeping
      // the one the slider was left on, or the control would display a value that is not
      // the one in force.
      setThresholdDraft(profile.auto_speak_threshold);
      setProfileStatus(t("awaazProfileSaved"));
    } catch {
      // Never a locally-applied fallback. What this screen shows about how it speaks has
      // to be what the server will actually do, or the display is a lie about a safety
      // setting.
      setProfileStatus(t("awaazProfileSaveFailed"));
    } finally {
      setProfileBusy(false);
    }
  }, [patientId, profileBusy, t]);

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
      const recorder = await startAudioRecording();
      if (!mountedRef.current) { recorder.cancel(); return; }
      emergencyRecorderRef.current = recorder;
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
    // Typing again instead of choosing is a correction of what was on screen.
    closePolicySlate(correctedOutcome());
    try {
      const res: AwaazSpeakResult = await api.awaazSpeak(patientId, {
        text: freeText.trim(), lang,
      });
      if (res.speak_now && res.text) {
        // Dysarthria path, above threshold — the server said yes.
        say(res.text, res.lang);
        setFreeText("");
      } else if (res.requires_confirmation) {
        // Aphasia path — candidates only. NOTHING is voiced until a tap.
        const offered = res.candidates.length ? res.candidates : [freeText.trim()];
        const scored = scoredSlateFromSpeakResult(res);
        if (!scored) {
          setCandidates(offered);
        } else {
          // The server owns the randomisation. Whatever order comes back is the order the
          // patient sees, because the propensity it recorded is the probability of exactly
          // that. When it refuses, fails, or times out, `openPolicySlate` hands back the
          // original order and no event exists — the loop is identical either way.
          const opened = await openPolicySlate(api, patientId, scored, {
            consent: policyConsentRef.current,
          });
          policySlateRef.current = opened.slate;
          setCandidates(opened.texts);
        }
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("awaazNotSaved"));
    } finally {
      setBusy(false);
    }
  }, [closePolicySlate, freeText, lang, patientId, say, t]);

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
      say(res.text, res.lang);
      setCandidates([]);
      setFreeText("");
      // Reported only here. `output_spoken` may not be claimed before the confirmation the
      // server accepted, and a failed confirmation leaves the slate open for another tap.
      closePolicySlate(selectedOutcome(text));
    } catch {
      setActionError(t("awaazConfirmFailed"));
    } finally {
      setBusy(false);
    }
  }, [closePolicySlate, lang, patientId, say, t]);

  const addPersonalPhrase = useCallback(async () => {
    const boardLang = normaliseListenerLanguage(
      currentBoard?.cards.find((card) => card.is_emergency)?.lang ?? lang,
    );
    const payload = personalPhrasePayload(personalPhrase, boardLang);
    if (!payload || phraseBusy) return;
    setPhraseBusy(true);
    setPhraseStatus(null);
    try {
      const card = await api.awaazAddCard(patientId, payload);
      setBoard((current) => current?.patient_id === patientId
        ? { ...current, cards: [...current.cards, card] }
        : current);
      setPersonalPhrase("");
      setPhraseStatus(t("awaazPhraseAdded"));
    } catch {
      setPhraseStatus(t("awaazPhraseAddFailed"));
    } finally {
      setPhraseBusy(false);
    }
  }, [currentBoard, lang, patientId, personalPhrase, phraseBusy, t]);

  const removePhrase = useCallback(async (cardId: string) => {
    if (phraseBusy || !window.confirm(t("awaazPhraseRemoveConfirm"))) return;
    setPhraseBusy(true);
    setPhraseStatus(null);
    try {
      await api.awaazDeleteCard(cardId);
      setBoard((current) => current?.patient_id === patientId
        ? { ...current, cards: current.cards.filter((card) => card.id !== cardId) }
        : current);
      setPhraseStatus(t("awaazPhraseRemoved"));
    } catch {
      setPhraseStatus(t("awaazPhraseRemoveFailed"));
    } finally {
      setPhraseBusy(false);
    }
  }, [patientId, phraseBusy, t]);

  const emergency = useCallback(async () => {
    // Start the on-device WAV before touching the network. A stock browser voice is only a
    // visible fallback and is never counted as offline-capable because browsers may fetch
    // voices from the network.
    // The emergency flow is never ranked and never reaches the policy endpoints (D-063).
    // An open slate is dropped outright rather than reported: nothing on this path may
    // compete for the network with the alert that is going out.
    policySlateRef.current = null;
    let offlineAudioPlayed = false;
    if (emergencyAudioReady && emergencyAudioUrl) {
      offlineAudioPlayed = await startEmergencyPlayback(new Audio(emergencyAudioUrl));
    }
    if (offlineAudioPlayed) {
      // The caregiver's own recording is already playing. Show it on the plate without
      // starting a second voice on top of it.
      setSpoken({ text: emergencyText, lang: normaliseListenerLanguage(emergencyLang) });
      setVoicing(false);
    } else {
      say(emergencyText, emergencyLang);
    }
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
    say,
    shareEmergencyLocation,
    t,
  ]);

  /** The listener missed it, or the patient wants it again. One tap, no server round trip. */
  const repeatSpoken = useCallback(() => {
    if (!spoken) return;
    haptic();
    say(spoken.text, spoken.lang, spoken.cardId);
  }, [say, spoken]);

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

  const [listenerCapability, setListenerCapability] = useState<ListenerCapability | null>(null);
  const [listenerBusy, setListenerBusy] = useState(false);
  const [listenerStatus, setListenerStatus] = useState<string | null>(null);

  useEffect(() => {
    // A capability belongs to exactly one patient. Never carry its URL into a route whose
    // patient parameter changed while React reused this component instance.
    let live = true;
    setListenerCapability(null);
    setListenerStatus(null);
    setListenerBusy(true);
    void api.awaazActiveListener(patientId)
      .then((session) => {
        if (!live || !session.active || !session.token) return;
        const sessionLang = normaliseListenerLanguage(session.lang);
        setListenerCapability({
          token: session.token,
          url: `${window.location.origin}${listenerSharePath(session.token, sessionLang)}`,
        });
      })
      .catch(() => undefined)
      .finally(() => { if (live) setListenerBusy(false); });
    return () => { live = false; };
  }, [patientId]);

  /**
   * Mint a short-lived listener link. The token IS the capability, so the display name is
   * the caregiver's choice and defaults to something non-identifying — a link can be
   * forwarded, and a stranger does not need the patient's full name to help them.
   */
  const mintListenerLink = useCallback(async () => {
    if (listenerCapability) {
      try {
        if (!navigator.clipboard) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(listenerCapability.url);
        setListenerStatus(t("awaazListenerCopied"));
        setActionError(null);
      } catch {
        setActionError(t("awaazListenerCopyFailed"));
      }
      return;
    }
    if (listenerBusy) return;
    setListenerBusy(true);
    try {
      setActionError(null);
      setListenerStatus(null);
      const res = await api.awaazMintListener(patientId, {
        display_name: t("awaazListenerDefaultName"),
        lang, ttl_minutes: 30,
      });
      const url = `${window.location.origin}${listenerSharePath(res.token, lang)}`;
      setListenerCapability({ token: res.token, url });
      setListenerStatus(t("awaazListenerCreated"));
      await navigator.clipboard?.writeText(url).catch(() => undefined);
    } catch {
      setActionError(t("awaazListenerFailed"));
    } finally {
      setListenerBusy(false);
    }
  }, [lang, listenerBusy, listenerCapability, patientId, t]);

  const revokeListenerLink = useCallback(async () => {
    if (!listenerCapability || listenerBusy) return;
    setListenerBusy(true);
    setActionError(null);
    try {
      await api.awaazRevokeListener(listenerCapability.token);
      setListenerCapability(null);
      setListenerStatus(t("awaazListenerRevoked"));
    } catch {
      setActionError(t("awaazListenerRevokeFailed"));
    } finally {
      setListenerBusy(false);
    }
  }, [listenerBusy, listenerCapability, t]);

  if (error && !currentBoard) {
    return (
      <AppShell>
        <div
          className="patient-scale mx-auto flex w-full max-w-xl flex-col gap-4 lg:max-w-5xl"
          data-motion={prefs.lowMotion ? "low" : undefined}
          data-text={prefs.largeText ? "large" : undefined}
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
          <UtterancePlate phrase={spoken} voicing={voicing} onRepeat={repeatSpoken} />
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
        /* `max-w-xl` was applied at EVERY width, so a 1440px laptop rendered a 576px
           phone column with two card columns and ~430px of dead space on each side --
           the same "phone layout blown up rather than a desktop one" that
           DESIGN_LANGUAGE §6 already called out for buttons. The cap widens with the
           viewport instead, and the board below adds columns rather than stretching
           tiles, so a card never grows past a comfortable tap target. */
        className="mx-auto flex w-full max-w-xl flex-col gap-6 lg:max-w-5xl"
        data-motion={prefs.lowMotion ? "low" : undefined}
        data-text={prefs.largeText ? "large" : undefined}
        onPointerDown={beginLongPress}
        onPointerMove={moveLongPress}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onContextMenu={suppressHoldMenu}
      >
        {/* ------------------------------------------------------- the speaking surface
            Everything a patient touches, and the only part carrying `.patient-scale`:
            a 20px floor and a 64px tap target, the contract every other patient screen
            already has and this one was missing. The caregiver tools below sit OUTSIDE
            it, because a 64px minimum on a "delete this recording" link is not care, it
            is a bigger mistake to make by accident. */}
        <div className="patient-scale flex flex-col gap-5">
          {/* Emergency is first, biggest, and always the same place. Its own group so the
              dial link and the hold hint stay attached to it rather than being spaced
              like three unrelated things. */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void emergency()}
              className="focus-ring tactile flex min-h-20 items-center justify-center gap-3 rounded-2xl bg-alert text-2xl font-semibold text-white"
            >
              <AlertTriangle className="h-8 w-8" aria-hidden /> {emergencyText}
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <EmergencyDialLink />
              <p className="flex-1 basis-56 text-center text-base text-muted-foreground">
                {longPressArmed ? t("awaazEmergencyHolding") : t("awaazEmergencyHoldHint")}
              </p>
            </div>
          </div>

          <UtterancePlate phrase={spoken} voicing={voicing} onRepeat={repeatSpoken} />

          {/* One region for every notice. As six independent siblings they each took a
              `gap-5` from the column even when absent was the normal case, and three at
              once pushed the board off a phone screen entirely. `empty:hidden` because a
              wrapper whose conditions are all false must not leave a gap behind. */}
          <div className="flex flex-col gap-2 empty:hidden">
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
            {usingOfflineBoard && (
              <p
                role="status"
                className="rounded-xl border border-watch/40 bg-watch-soft p-4 text-base leading-relaxed"
              >
                {t("awaazBoardOfflineReady")}
              </p>
            )}
            {actionError && (
              <p role="alert" className="rounded-xl border border-alert/40 bg-alert-soft p-4 text-base text-alert">
                {actionError}
              </p>
            )}
            {captureStatus && (
              <p aria-live="polite" className="rounded-xl border border-stable/40 bg-stable-soft p-4 text-base">
                {captureStatus}
              </p>
            )}
          </div>

          {/* Neural Voice Recovery / Muffled Speech Reconstruction Demonstrator */}
          <AwaazSpeechDemonstrator
            patientId={patientId}
            lang={lang}
            isDysarthriaDominant={!isAphasia}
            onPhraseSpoken={(phrase) => {
              setSpoken(phrase);
              setVoicing(true);
              if (voiceCeilingRef.current !== null) {
                window.clearTimeout(voiceCeilingRef.current);
              }
              voiceCeilingRef.current = window.setTimeout(() => {
                setVoicing(false);
              }, voicingCeilingMs(phrase.text));
            }}
          />

          {/* Columns, not wider tiles. Two on a phone is the floor a 64px tap target and
              Gurmukhi/Devanagari phrase text need; beyond that, extra width buys more
              cards on screen at the same size, which is what shortens the reach for
              someone using one working hand. Order is the SERVER'S — frequency-ranked —
              and nothing here re-sorts it, which is why the tiles are not grouped by
              category: a category grid would move the tile somebody uses forty times a
              day away from where their hand has learned it is. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {currentBoard.cards.filter((card) => !card.is_emergency).map((c) => {
              const saying = voicing && spoken?.cardId === c.id;
              const cardText = getLocalizedCardText(c, lang);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  lang={lang}
                  onClick={() => void speakCard(c.id, cardText, lang)}
                  className={cn(
                    "focus-ring tactile tactile-lift flex min-h-28 flex-col items-center justify-center gap-2",
                    "rounded-2xl border-2 p-3 text-center leading-snug disabled:opacity-50",
                    saying ? "border-accent bg-secondary" : "border-line bg-card",
                  )}
                >
                  <PhraseIcon name={c.icon} active={saying} />
                  <span>{cardText}</span>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-line p-4">
            {/* NOT branched on the speech profile, and that is a correction.
                The auto-speak gate takes a CONFIDENCE — it is for speech this app
                recognised, where the words are a machine's reading of a sound. Typing
                carries no confidence and no client sends one, so `decide()` sees 0.0 and
                returns `confirm` for every profile, every time. Branching the label meant
                a dysarthria-dominant patient was shown "Say it", pressed it, and got the
                options list anyway — the precise failure the profile endpoint refuses a
                409 to avoid, arriving through the label instead of the setting. */}
            <label htmlFor="awaaz-free-text" className="block text-base text-muted-foreground">
              {t("awaazTypeConfirm")}
            </label>
            {/* `flex-1` without `min-w-0` cannot shrink below its content, and the button
                beside it does not shrink at all, so at 390px this row was 442px wide and
                pushed "Show options" off the right edge of the phone the product targets.
                `min-w-0` lets the field give way; `flex-wrap` puts the button on its own
                line rather than squeezing it under a longer translation. */}
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                id="awaaz-free-text"
                value={freeText}
                disabled={usingOfflineBoard}
                onChange={(e) => setFreeText(e.target.value)}
                className="focus-ring min-h-16 min-w-0 flex-1 basis-48 rounded-xl border-2 border-line px-4 text-xl disabled:opacity-50"
              />
              <Button className="min-h-16 px-5" disabled={
                usingOfflineBoard || busy || !freeText.trim()
              }
                onClick={() => void submitFree()}>
                {t("awaazOffer")}
              </Button>
            </div>

            {candidates.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                <p className="text-base text-muted-foreground">{t("awaazPickOne")}</p>
                {candidates.map((c) => (
                  <button key={c} type="button" disabled={busy}
                    onClick={() => void confirmCandidate(c)}
                    className="focus-ring tactile min-h-16 rounded-xl border-2 border-accent/50 bg-card px-4 text-left text-xl">
                    {c}
                  </button>
                ))}
                <button type="button"
                  onClick={() => {
                    closePolicySlate(rejectedOutcome(candidates));
                    setCandidates([]);
                  }}
                  className="focus-ring min-h-12 text-base text-muted-foreground underline">
                  {t("awaazNone")}
                </button>
              </div>
            )}
          </div>

          <p className="text-base text-muted-foreground">
            {isAphasia ? t("awaazAphasiaNote") : t("awaazDysarthriaNote")}
          </p>
        </div>

        {/* ---------------------------------------------------------- caregiver tools
            Deliberately at the BOTTOM, visually quiet, and outside `.patient-scale`: the
            patient uses the top of this screen to speak, and a share button competing
            with the emergency card would be a design failure with real consequences.
            The practice panel is the newest arrival — it used to sit between the
            emergency control and the board, which put a training feature in the way of
            somebody trying to ask for the toilet. */}
        <section className="flex flex-col gap-2 border-t border-line pt-5">
          <h2 className="text-label text-muted-foreground">{t("awaazCaregiverTools")}</h2>
          {/* ------------------------------------------------- the speech assessment
              THE SETTING THE WHOLE SECOND PRODUCT TURNS ON, and it had no control at all:
              the endpoint existed, was audited, and was reachable only by curl, so every
              patient sat at `unassessed` — which the gate treats as aphasia — and the
              dysarthria path was unreachable from the app it was built for.

              Not hidden from a patient signing in on their own account, on purpose. The
              handset in this population is usually shared, and a caregiver setting this up
              is very often looking at a session that is signed in as the patient; gating
              the control on role would lock out the person it is for. It is quiet, it is
              collapsed, it is in the caregiver zone, and the copy says whose decision it
              is. INV-6 still puts the real authorisation on the server. */}
          <details className="rounded-xl border border-line p-3">
            <summary className="flex cursor-pointer list-none items-start gap-3">
              <Stethoscope className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
              <span>
                <span className="block text-sm font-semibold">{t("awaazProfileTitle")}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t(profileHeadlineKey(currentBoard.profile.speech_profile))}
                </span>
              </span>
            </summary>

            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {t("awaazProfileHelp")}
            </p>

            {/* Radios, not a select. Each option needs the sentence under it — what
                changes is whether this app may ever put words in somebody's mouth, and a
                collapsed dropdown hides exactly the text that says so. */}
            <fieldset className="mt-3 flex flex-col gap-2" disabled={usingOfflineBoard || profileBusy}>
              <legend className="sr-only">{t("awaazProfileTitle")}</legend>
              {AWAAZ_SPEECH_PROFILES.map((option) => {
                const chosen = currentBoard.profile.speech_profile === option;
                return (
                  <label
                    key={option}
                    className={cn(
                      "tactile flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-3",
                      chosen ? "border-accent bg-secondary" : "border-line",
                      (usingOfflineBoard || profileBusy) && "opacity-50",
                    )}
                  >
                    <input
                      type="radio"
                      name="awaaz-speech-profile"
                      value={option}
                      checked={chosen}
                      onChange={() => void saveProfile({
                        speech_profile: option,
                        // Leaving the one eligible profile takes the switch with it, in the
                        // same request. See `saveProfile`.
                        ...(option === "dysarthria_dominant"
                          ? {}
                          : { auto_speak_enabled: false }),
                      })}
                      className="mt-0.5 h-5 w-5 accent-accent"
                    />
                    <span>
                      <span className="block text-sm font-medium">
                        {t(PROFILE_LABEL_KEY[option])}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        {t(PROFILE_SUMMARY_KEY[option])}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {/* Only reachable from the one profile the server accepts it for. Rendering it
                greyed out under the other two would advertise a setting that cannot be
                had, and invite somebody to change the assessment in order to get it. */}
            {currentBoard.profile.speech_profile === "dysarthria_dominant" && (
              <div className="mt-3 rounded-lg border border-line bg-card p-3">
                <label className="flex min-h-11 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={currentBoard.profile.auto_speak_enabled}
                    disabled={usingOfflineBoard || profileBusy}
                    onChange={(event) => void saveProfile({
                      auto_speak_enabled: event.target.checked,
                    })}
                    className="mt-0.5 h-5 w-5 accent-accent"
                  />
                  <span>
                    <span className="block text-sm font-medium">{t("awaazAutoSpeakLabel")}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {t("awaazAutoSpeakHelp")}
                    </span>
                  </span>
                </label>

                {/* The setting is real, audited, and read by the gate — and it changes
                    nothing a caregiver can see today, because the input it governs does
                    not exist in this build. Saying so here is the alternative to letting
                    them discover it by testing a safety setting on a patient. */}
                {currentBoard.profile.auto_speak_enabled && (
                  <p className="mt-3 rounded-lg border border-watch/40 bg-watch-soft p-3 text-xs leading-relaxed">
                    {t("awaazAutoSpeakPending")}
                  </p>
                )}

                {currentBoard.profile.auto_speak_enabled && (
                  <div className="mt-3 border-t border-line pt-3">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <label htmlFor="awaaz-auto-speak-threshold">
                        {t("awaazAutoSpeakThreshold")}
                      </label>
                      <strong className="tabular">
                        {Math.round(thresholdDraft * 100)}%
                      </strong>
                    </div>
                    {/* Floor is 70%, matching MIN_AUTO_SPEAK_THRESHOLD — the server clamps
                        there anyway, and a slider that travels somewhere the server will
                        not follow it is a control that lies. Committed on release rather
                        than on every step, so dragging it is one audit entry and not
                        thirty. */}
                    <input
                      id="awaaz-auto-speak-threshold"
                      type="range"
                      min="0.7"
                      max="0.99"
                      step="0.01"
                      value={thresholdDraft}
                      disabled={usingOfflineBoard || profileBusy}
                      onChange={(event) => setThresholdDraft(Number(event.target.value))}
                      onPointerUp={() => void saveProfile({
                        auto_speak_threshold: thresholdDraft,
                      })}
                      onKeyUp={() => void saveProfile({
                        auto_speak_threshold: thresholdDraft,
                      })}
                      className="mt-2 w-full accent-accent"
                    />
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {t("awaazAutoSpeakThresholdHelp")}
                    </p>
                  </div>
                )}
              </div>
            )}

            {profileStatus && (
              <p aria-live="polite" className="mt-3 text-xs text-muted-foreground">
                {profileStatus}
              </p>
            )}
          </details>
          <details className="rounded-xl border border-line p-3">
            <summary className="flex cursor-pointer list-none items-start gap-3">
              <Mic className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
              <span>
                <span className="block text-sm font-semibold">{t("awaazPracticeTitle")}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{t("awaazPracticeIntro")}</span>
              </span>
            </summary>

            <label className="mt-4 flex min-h-12 items-start gap-3 rounded-xl border border-line bg-card p-3 text-sm">
              <input
                type="checkbox"
                checked={captureConsent}
                disabled={usingOfflineBoard || isRecording || Boolean(pendingCapture)}
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
                disabled={usingOfflineBoard || isRecording}
                aria-label={t("awaazPauseLabel")}
                onChange={(event) => setEndpointDraft(Number(event.target.value))}
                className="mt-3 w-full accent-accent"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={autoStop}
                    disabled={usingOfflineBoard || isRecording}
                    onChange={(event) => setAutoStop(event.target.checked)}
                    className="h-5 w-5 accent-accent"
                  />
                  {t("awaazAutoStop")}
                </label>
                <button
                  type="button"
                  disabled={
                    usingOfflineBoard || isRecording
                    || endpointDraft === currentBoard.profile.endpoint_silence_seconds
                  }
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
                  aria-label={t("awaazMicLevel")}
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
                usingOfflineBoard || !captureConsent || Boolean(pendingCapture)
                || busy || isEmergencyRecording
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
                  {currentBoard.cards.filter((card) => !card.is_emergency).map((card) => {
                    const cardText = getLocalizedCardText(card, lang);
                    return (
                      <button
                        key={`pair-${card.id}`}
                        type="button"
                        disabled={busy}
                        onClick={() => void speakCard(card.id, cardText, lang)}
                        className="min-h-14 rounded-xl border border-line px-3 text-left text-base disabled:opacity-50"
                      >
                        {cardText}
                      </button>
                    );
                  })}
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
          {/* Off by default and consequence-free either way: with it off the confirmation
              loop and the phrase board behave exactly as they do with it on. */}
          <div className="rounded-xl border border-line p-3">
            <p className="text-sm font-medium">{t("awaazPolicyLoggingTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("awaazPolicyLoggingHelp")}
            </p>
            <label className="mt-3 flex min-h-11 items-start gap-3 text-xs">
              <input
                type="checkbox"
                checked={policyLoggingConsent}
                onChange={(event) => {
                  setPolicyLoggingConsent(event.target.checked);
                  writePolicyLoggingConsent(patientId, event.target.checked);
                }}
                className="mt-0.5 h-5 w-5 accent-accent"
              />
              <span>{t("awaazPolicyLoggingConsent")}</span>
            </label>
          </div>
          <details className="rounded-xl border border-line p-3">
            <summary className="flex cursor-pointer list-none items-start gap-3">
              <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
              <span>
                <span className="block text-sm font-semibold">
                  {t("awaazManagePhrasesTitle")}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t("awaazManagePhrasesHelp")}
                </span>
              </span>
            </summary>

            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void addPersonalPhrase();
              }}
            >
              <input
                value={personalPhrase}
                onChange={(event) => setPersonalPhrase(event.target.value)}
                maxLength={200}
                disabled={usingOfflineBoard}
                placeholder={t("awaazPhrasePlaceholder")}
                className="min-h-12 min-w-0 flex-1 rounded-lg border border-line px-3 text-base"
              />
              <button
                type="submit"
                disabled={
                  usingOfflineBoard || phraseBusy || isRecording || Boolean(pendingCapture)
                  || !personalPhrase.trim()
                }
                className="min-h-12 rounded-lg border border-line px-3 text-sm font-medium disabled:opacity-50"
              >
                {t("awaazPhraseAdd")}
              </button>
            </form>

            <ul className="mt-3 flex flex-col gap-1">
              {currentBoard.cards.filter((card) => !card.is_emergency).map((card) => {
                const cardText = getLocalizedCardText(card, lang);
                return (
                  <li key={card.id} className="flex items-center justify-between gap-3 rounded-lg bg-secondary px-3 py-2">
                    <span className="min-w-0 break-words text-sm">{cardText}</span>
                    <button
                      type="button"
                      disabled={
                        usingOfflineBoard || phraseBusy || isRecording || Boolean(pendingCapture)
                      }
                      onClick={() => void removePhrase(card.id)}
                      aria-label={`${t("awaazPhraseRemove")}: ${cardText}`}
                      className="flex min-h-10 shrink-0 items-center gap-1 text-xs text-alert underline disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      {t("awaazPhraseRemove")}
                    </button>
                  </li>
                );
              })}
            </ul>
            {phraseStatus && (
              <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
                {phraseStatus}
              </p>
            )}
          </details>
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
            disabled={usingOfflineBoard || listenerBusy}
            onClick={() => void mintListenerLink()}
            className="min-h-12 rounded-xl border border-line px-4 text-sm disabled:opacity-50"
          >
            {listenerCapability ? t("awaazListenerCopy") : t("awaazListenerShare")}
          </button>
          {listenerCapability && (
            <div className="rounded-xl border border-line bg-secondary p-3">
              <p className="break-all text-xs">{listenerCapability.url}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("awaazListenerActive")}
              </p>
              <button
                type="button"
                disabled={usingOfflineBoard || listenerBusy}
                onClick={() => void revokeListenerLink()}
                className="mt-3 flex min-h-10 items-center gap-2 text-xs font-medium text-alert underline disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden />
                {listenerBusy ? t("awaazListenerRevoking") : t("awaazListenerRevoke")}
              </button>
            </div>
          )}
          {listenerStatus && (
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {listenerStatus}
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

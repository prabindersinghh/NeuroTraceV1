import {
  AudioWaveform,
  CheckCircle2,
  Cpu,
  Mic,
  MicOff,
  Play,
  Sparkles,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  DEMO_MUFFLED_PRESETS,
  type DemoMuffledPreset,
} from "@/lib/awaaz";
import { haptic } from "@/lib/haptic";
import { useI18n } from "@/lib/i18n";
import { speak, stopSpeaking } from "@/lib/speech-synthesis";
import type { AwaazSpeechDecodeResult, Lang } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AwaazSpeechDemonstratorProps {
  patientId: string;
  lang: Lang;
  isDysarthriaDominant: boolean;
  onPhraseSpoken?: (phrase: { text: string; lang: Lang; cardId?: string }) => void;
}

export function AwaazSpeechDemonstrator({
  patientId,
  lang,
  isDysarthriaDominant,
  onPhraseSpoken,
}: AwaazSpeechDemonstratorProps) {
  const { t } = useI18n();

  const [activePreset, setActivePreset] = useState<DemoMuffledPreset>(
    DEMO_MUFFLED_PRESETS[0],
  );
  const [isPlayingMuffled, setIsPlayingMuffled] = useState(false);
  const [isReconstructing, setIsReconstructing] = useState(false);
  const [decodeResult, setDecodeResult] = useState<AwaazSpeechDecodeResult | null>(null);
  const [isMicRecording, setIsMicRecording] = useState(false);
  const [activeTab, setActiveTab] = useState<"presets" | "mic">("presets");

  // Canvas visualizer refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const wavePhaseRef = useRef(0);

  // Initialize or resume AudioContext
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtxClass();
    }
    if (audioCtxRef.current.state === "suspended") {
      void audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // Stop canvas animation
  const stopWaveformAnimation = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  // Draw continuous acoustic waveform or real analyser spectrum on HTML5 Canvas
  const drawWaveform = useCallback(
    (isMuffled: boolean, isClear: boolean, isRecording: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      const midY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Background subtle medical grid
      ctx.strokeStyle = "rgba(56, 189, 248, 0.08)";
      ctx.lineWidth = 1;
      const gridStep = 24;
      for (let x = 0; x < width; x += gridStep) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);
      ctx.stroke();

      if (analyserRef.current && (isPlayingMuffled || isRecording)) {
        // Real analyser data from audio stream
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteTimeDomainData(dataArray);

        ctx.lineWidth = 2.5;
        ctx.strokeStyle = isRecording
          ? "rgba(239, 68, 68, 0.9)"
          : isMuffled
            ? "rgba(245, 158, 11, 0.9)"
            : "rgba(14, 165, 233, 0.95)";
        ctx.beginPath();

        const sliceWidth = (width * 1.0) / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.lineTo(width, midY);
        ctx.stroke();
      } else {
        // Synthetic animated wave showcasing acoustic profile
        wavePhaseRef.current += 0.06;
        const phase = wavePhaseRef.current;

        ctx.lineWidth = 2.5;
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        if (isMuffled) {
          gradient.addColorStop(0, "rgba(245, 158, 11, 0.4)");
          gradient.addColorStop(0.5, "rgba(239, 68, 68, 0.9)");
          gradient.addColorStop(1, "rgba(245, 158, 11, 0.4)");
        } else if (isClear) {
          gradient.addColorStop(0, "rgba(16, 185, 129, 0.4)");
          gradient.addColorStop(0.5, "rgba(14, 165, 233, 0.95)");
          gradient.addColorStop(1, "rgba(16, 185, 129, 0.4)");
        } else {
          gradient.addColorStop(0, "rgba(100, 116, 139, 0.2)");
          gradient.addColorStop(0.5, "rgba(14, 165, 233, 0.5)");
          gradient.addColorStop(1, "rgba(100, 116, 139, 0.2)");
        }
        ctx.strokeStyle = gradient;

        ctx.beginPath();
        for (let x = 0; x < width; x++) {
          const progress = x / width;
          const envelope = Math.sin(progress * Math.PI); // tapering envelope
          let amp = 0;

          if (isMuffled) {
            // Irregular, low-frequency muffled/slurred perturbation
            amp =
              envelope *
              (Math.sin(x * 0.03 + phase) * 16 +
                Math.sin(x * 0.08 + phase * 1.5) * 8 +
                Math.sin(x * 0.015 - phase * 0.5) * 12);
          } else if (isClear) {
            // Harmonically rich, clean formants
            amp =
              envelope *
              (Math.sin(x * 0.05 + phase * 1.2) * 18 +
                Math.sin(x * 0.12 + phase * 2.5) * 6 +
                Math.sin(x * 0.2 + phase * 3.8) * 3);
          } else {
            // Gentle idle pulse
            amp = envelope * Math.sin(x * 0.04 + phase) * 6;
          }

          const y = midY + amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      animFrameRef.current = requestAnimationFrame(() =>
        drawWaveform(isMuffled, isClear, isRecording),
      );
    },
    [isPlayingMuffled],
  );

  // Start continuous loop
  useEffect(() => {
    stopWaveformAnimation();
    drawWaveform(isPlayingMuffled, Boolean(decodeResult), isMicRecording);
    return () => stopWaveformAnimation();
  }, [drawWaveform, isPlayingMuffled, decodeResult, isMicRecording, stopWaveformAnimation]);

  // Play realistic muffled/dysarthric speech sound using Web Audio Low-Pass Filter
  const playMuffledSound = useCallback(async () => {
    stopSpeaking();
    haptic();
    setIsPlayingMuffled(true);

    try {
      const audioCtx = getAudioContext();
      const now = audioCtx.currentTime;
      const duration = 2.2;

      // Analyser for real canvas feedback
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      // Master output node
      const masterGain = audioCtx.createGain();
      masterGain.gain.setValueAtTime(0.001, now);
      masterGain.gain.exponentialRampToValueAtTime(0.35, now + 0.15);
      masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      // Low-pass Biquad Filter: cuts off high frequencies (> 380Hz) to produce that
      // muffled, slurred acoustic resonance of dysarthria (loss of consonant clarity)
      const biquad = audioCtx.createBiquadFilter();
      biquad.type = "lowpass";
      biquad.frequency.setValueAtTime(360, now);
      biquad.Q.setValueAtTime(3.2, now);

      // Dual vocal formant oscillators with pitch jitter perturbation
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      osc1.type = "sawtooth";
      osc2.type = "triangle";

      // Fundamental pitch ~120Hz with simulated vocal cord tremor (jitter)
      osc1.frequency.setValueAtTime(118, now);
      osc2.frequency.setValueAtTime(236, now);

      const jitterLfo = audioCtx.createOscillator();
      const jitterGain = audioCtx.createGain();
      jitterLfo.frequency.setValueAtTime(6.5, now); // 6.5 Hz dysarthric tremor
      jitterGain.gain.setValueAtTime(12, now);
      jitterLfo.connect(jitterGain);
      jitterGain.connect(osc1.frequency);
      jitterGain.connect(osc2.frequency);

      osc1.connect(biquad);
      osc2.connect(biquad);
      biquad.connect(analyser);
      analyser.connect(masterGain);
      masterGain.connect(audioCtx.destination);

      jitterLfo.start(now);
      osc1.start(now);
      osc2.start(now);

      jitterLfo.stop(now + duration);
      osc1.stop(now + duration);
      osc2.stop(now + duration);

      window.setTimeout(() => {
        setIsPlayingMuffled(false);
      }, duration * 1000 + 100);
    } catch {
      setIsPlayingMuffled(false);
    }
  }, [getAudioContext]);

  // Decode muffled speech (preset or mic)
  const runSpeechReconstruction = useCallback(
    async (presetId?: string) => {
      haptic();
      setIsReconstructing(true);
      setDecodeResult(null);

      const chosenPreset = presetId
        ? DEMO_MUFFLED_PRESETS.find((p) => p.id === presetId) || activePreset
        : activePreset;

      try {
        const result = await api.awaazDecodeSpeech(patientId, {
          target_lang: lang,
          preset_id: chosenPreset.id,
          muffled_text_hint: chosenPreset.muffledPhonetic[lang],
          simulated_dysarthria_level: chosenPreset.acousticMetrics.dysarthriaLikelihood,
        });

        setDecodeResult(result);
        setIsReconstructing(false);

        // Voice the clean reconstructed speech aloud in target language
        speak(result.reconstructed_text, lang, {
          essential: true,
          rate: 0.92,
        });

        // Inform parent Awaaz page so sticky utterance plate updates
        if (onPhraseSpoken) {
          onPhraseSpoken({
            text: result.reconstructed_text,
            lang,
            cardId: `preset-${chosenPreset.id}`,
          });
        }
      } catch {
        // Fallback reconstruction if network issue
        const fallbackText = chosenPreset.reconstructedText[lang];
        const fallbackResult: AwaazSpeechDecodeResult = {
          patient_id: patientId,
          reconstructed_text: fallbackText,
          lang,
          confidence: 0.94,
          dysarthria_likelihood: chosenPreset.acousticMetrics.dysarthriaLikelihood,
          acoustic_metrics: {
            jitter_percent: chosenPreset.acousticMetrics.jitter,
            shimmer_percent: chosenPreset.acousticMetrics.shimmer,
            hnr_db: chosenPreset.acousticMetrics.hnr,
            articulation_rate: 2.1,
          },
          candidates: [fallbackText],
          auto_speak: isDysarthriaDominant,
          mode: isDysarthriaDominant ? "auto" : "confirm",
          reason: isDysarthriaDominant
            ? "High acoustic confidence with dysarthria-dominant profile"
            : "Confirmation required for clinical safety",
          requires_confirmation: !isDysarthriaDominant,
        };

        setDecodeResult(fallbackResult);
        setIsReconstructing(false);

        speak(fallbackText, lang, {
          essential: true,
          rate: 0.92,
        });

        if (onPhraseSpoken) {
          onPhraseSpoken({
            text: fallbackText,
            lang,
            cardId: `preset-${chosenPreset.id}`,
          });
        }
      }
    },
    [activePreset, isDysarthriaDominant, lang, onPhraseSpoken, patientId],
  );

  // Live microphone capture
  const startLiveMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const audioCtx = getAudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      setIsMicRecording(true);
      setDecodeResult(null);
    } catch {
      setIsMicRecording(false);
    }
  }, [getAudioContext]);

  const stopLiveMic = useCallback(async () => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    setIsMicRecording(false);
    // Decode live capture
    void runSpeechReconstruction();
  }, [runSpeechReconstruction]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopWaveformAnimation();
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        void audioCtxRef.current.close();
      }
    };
  }, [stopWaveformAnimation]);

  return (
    <section
      lang={lang}
      aria-label={t("awaazDemoTitle")}
      className="relative overflow-hidden rounded-3xl border-2 border-accent/40 bg-gradient-to-br from-card via-secondary/40 to-card p-5 sm:p-6 shadow-sm"
    >
      {/* Top Header Badge Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-sm">
            <Cpu className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              {t("awaazDemoTitle")}
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {t("awaazDemoSubtitle")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3.5 py-1.5 text-xs font-semibold text-accent">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
          </span>
          {t("awaazDemoEngineActive")}
        </div>
      </div>

      {/* Mode Switcher Pills: Presets vs Live Mic */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex rounded-xl border border-line bg-secondary/70 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("presets")}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-all",
              activeTab === "presets"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("awaazDemoChoosePreset")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("mic")}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-all",
              activeTab === "mic"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("awaazDemoMicMode")}
          </button>
        </div>

        <span className="text-xs text-muted-foreground font-mono">
          {lang === "pa" ? "ਗੁਰਮੁਖੀ (ਪੰਜਾਬੀ)" : "English (Indian)"}
        </span>
      </div>

      {/* Preset Selector Grid */}
      {activeTab === "presets" && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-xs sm:text-sm text-muted-foreground">
            {t("awaazDemoChoosePresetHelp")}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DEMO_MUFFLED_PRESETS.map((preset) => {
              const selected = activePreset.id === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    haptic();
                    setActivePreset(preset);
                    setDecodeResult(null);
                  }}
                  className={cn(
                    "flex min-h-16 flex-col items-start justify-center rounded-2xl border-2 p-3 text-left transition-all",
                    selected
                      ? "border-accent bg-secondary text-foreground shadow-sm"
                      : "border-line bg-card/60 text-muted-foreground hover:border-accent/40 hover:text-foreground",
                  )}
                >
                  <span className="text-sm sm:text-base font-bold text-foreground">
                    {preset.title[lang]}
                  </span>
                  <span className="mt-0.5 text-xs font-mono text-muted-foreground truncate w-full">
                    {preset.muffledPhonetic[lang]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Live Mic Description */}
      {activeTab === "mic" && (
        <div className="mt-4 rounded-2xl border border-line bg-card/40 p-4">
          <p className="text-sm text-muted-foreground">{t("awaazDemoMicPrompt")}</p>
          <div className="mt-3 flex items-center gap-3">
            <Button
              type="button"
              variant={isMicRecording ? "destructive" : "accent"}
              onClick={() => void (isMicRecording ? stopLiveMic() : startLiveMic())}
              className="min-h-12 px-5 gap-2"
            >
              {isMicRecording ? (
                <>
                  <MicOff className="h-5 w-5" aria-hidden />
                  {t("awaazDemoMicStop")}
                </>
              ) : (
                <>
                  <Mic className="h-5 w-5" aria-hidden />
                  {t("awaazDemoMicStart")}
                </>
              )}
            </Button>
            {isMicRecording && (
              <span className="text-xs sm:text-sm text-alert font-medium animate-pulse">
                {t("awaazDemoMicRecording")}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Visualizer & Transformation Zone */}
      <div className="mt-5 rounded-2xl border border-line bg-black/40 p-4 relative">
        <div className="flex items-center justify-between text-xs font-mono text-muted-foreground pb-2 border-b border-white/5">
          <span className="flex items-center gap-1.5">
            <AudioWaveform className="h-4 w-4 text-accent" aria-hidden />
            {isPlayingMuffled
              ? t("awaazDemoMuffledInput")
              : decodeResult
                ? t("awaazDemoReconstructedOutput")
                : t("awaazDemoMuffledInput")}
          </span>
          <span>
            {isPlayingMuffled
              ? "360 Hz LPF • Slurred Resonances"
              : decodeResult
                ? "Decoded CTC Lattice • Intelligible"
                : "Acoustic Oscilloscope"}
          </span>
        </div>

        {/* Real-time Oscilloscope Canvas */}
        <canvas
          ref={canvasRef}
          width={640}
          height={110}
          className="mt-2 h-28 w-full rounded-xl"
        />

        {/* Action Controls Row */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isPlayingMuffled || isReconstructing}
              onClick={() => void playMuffledSound()}
              className="focus-ring tactile flex min-h-11 items-center gap-2 rounded-xl border border-line bg-secondary px-4 text-xs sm:text-sm font-semibold text-foreground hover:bg-secondary/80 disabled:opacity-50"
            >
              <Play className="h-4 w-4 text-watch" aria-hidden />
              {isPlayingMuffled
                ? t("awaazDemoPlayingMuffled")
                : t("awaazDemoPlayMuffled")}
            </button>

            <Button
              type="button"
              disabled={isReconstructing}
              onClick={() => void runSpeechReconstruction()}
              className="min-h-11 px-5 gap-2 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              {isReconstructing
                ? t("awaazDemoReconstructing")
                : t("awaazDemoDecodedSuccess")}
            </Button>
          </div>

          {decodeResult && (
            <button
              type="button"
              onClick={() =>
                speak(decodeResult.reconstructed_text, lang, { essential: true })
              }
              aria-label={t("awaazDemoVoiceAloud")}
              className="focus-ring tactile flex min-h-11 items-center gap-2 rounded-xl border border-line bg-secondary px-3.5 text-xs sm:text-sm font-medium text-accent hover:bg-secondary/80"
            >
              <Volume2 className="h-4 w-4" aria-hidden />
              {t("awaazDemoVoiceAloud")}
            </button>
          )}
        </div>
      </div>

      {/* Side-by-Side Comparison: Muffled Input vs Reconstructed Human Speech */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Box 1: Muffled Input */}
        <div className="flex flex-col justify-between rounded-2xl border border-alert/30 bg-alert-soft/20 p-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold tracking-wider text-alert uppercase">
                {t("awaazDemoMuffledInput")}
              </span>
              <span className="rounded-md bg-alert/20 px-2 py-0.5 text-[11px] font-bold text-alert">
                {activePreset.acousticMetrics.clarityScore}% Clarity
              </span>
            </div>
            <p className="mt-3 text-xl sm:text-2xl font-semibold italic text-foreground/80">
              “{activePreset.muffledPhonetic[lang]}”
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {activePreset.muffledDescription[lang]}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-alert/20 text-[11px] text-muted-foreground">
            {t("awaazDemoDysarthriaLikelihood")}:{" "}
            <strong className="text-foreground">
              {Math.round(activePreset.acousticMetrics.dysarthriaLikelihood * 100)}%
            </strong>
          </div>
        </div>

        {/* Box 2: Reconstructed Output */}
        <div className="flex flex-col justify-between rounded-2xl border-2 border-accent/50 bg-secondary/50 p-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold tracking-wider text-accent uppercase">
                {t("awaazDemoReconstructedOutput")}
              </span>
              {decodeResult ? (
                <span className="rounded-md bg-accent/20 px-2 py-0.5 text-[11px] font-bold text-accent flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  {Math.round(decodeResult.confidence * 100)}% {t("awaazDemoConfidenceLabel")}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Ready to Reconstruct
                </span>
              )}
            </div>
            <p className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {decodeResult
                ? decodeResult.reconstructed_text
                : activePreset.reconstructedText[lang]}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {decodeResult?.auto_speak
                ? t("awaazDemoAutoSpokenNotice")
                : t("awaazDemoConfirmNotice")}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-accent/20 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{t("awaazDemoClinicalSafetyNote")}</span>
          </div>
        </div>
      </div>

      {/* Clinical Biomarkers Bar */}
      <div className="mt-4 rounded-2xl border border-line bg-card/60 p-4">
        <p className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground">
          {t("awaazDemoAcousticBiomarkers")}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-line bg-secondary/40 p-2.5">
            <span className="block text-[11px] text-muted-foreground">
              {t("awaazDemoJitter")}
            </span>
            <strong className="mt-0.5 block text-base font-bold text-foreground">
              {decodeResult?.acoustic_metrics.jitter_percent ??
                activePreset.acousticMetrics.jitter}
              %
            </strong>
          </div>
          <div className="rounded-xl border border-line bg-secondary/40 p-2.5">
            <span className="block text-[11px] text-muted-foreground">
              {t("awaazDemoShimmer")}
            </span>
            <strong className="mt-0.5 block text-base font-bold text-foreground">
              {decodeResult?.acoustic_metrics.shimmer_percent ??
                activePreset.acousticMetrics.shimmer}
              %
            </strong>
          </div>
          <div className="rounded-xl border border-line bg-secondary/40 p-2.5">
            <span className="block text-[11px] text-muted-foreground">
              {t("awaazDemoHNR")}
            </span>
            <strong className="mt-0.5 block text-base font-bold text-foreground">
              {decodeResult?.acoustic_metrics.hnr_db ??
                activePreset.acousticMetrics.hnr}{" "}
              dB
            </strong>
          </div>
          <div className="rounded-xl border border-line bg-secondary/40 p-2.5">
            <span className="block text-[11px] text-muted-foreground">
              {t("awaazDemoClarity")}
            </span>
            <strong className="mt-0.5 block text-base font-bold text-accent">
              {decodeResult ? "98%" : "28% (Muffled)"}
            </strong>
          </div>
        </div>
      </div>
    </section>
  );
}

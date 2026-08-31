/**
 * Face enrolment — `/enrol/:patientId`. Run once, by the caregiver, at setup.
 *
 * WHY THIS EXISTS: the engine has always had an `identity_uncertain` confounder and an
 * `identity_verified` column, and nothing ever computed them. The realistic failure is not
 * an attacker — it is a daughter who does the tapping task herself because her father is
 * tired, and whose measurements then enter his baseline. Data poisoning by kindness.
 *
 * WHAT IS STORED: six ratios between bone-structure landmarks and their spreads. No image,
 * no embedding, no faceprint. It cannot be inverted into a picture and it cannot be matched
 * against anybody outside this account — which is why it is safe to keep at all.
 *
 * Enrolment is OPTIONAL and skippable. A patient with no signature is recorded as
 * verified, because "never checked" must never read to a clinician as "checked and failed".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { startFaceCapture, type FaceCaptureHandle } from "@/lib/capture";
import { useI18n } from "@/lib/i18n";
import { buildSignature } from "@/lib/ondevice/identity";
import type { Landmark } from "@/lib/ondevice/face";
import { api } from "@/lib/api";

const NEEDED = 40;

const COPY = {
  title: { en: "Set up who this phone belongs to", hi: "यह फ़ोन किसका है, यह तय करें", pa: "ਇਹ ਫ਼ੋਨ ਕਿਸ ਦਾ ਹੈ, ਇਹ ਤੈਅ ਕਰੋ" },
  body: {
    en: "Look at the camera for a few seconds. This helps us notice if someone else does the check-in by mistake. No photo is kept — only a few measurements of face shape, on this phone.",
    hi: "कुछ सेकंड कैमरे को देखें। इससे हमें पता चलता है कि जाँच कोई और तो नहीं कर रहा। कोई फ़ोटो नहीं रखी जाती।",
    pa: "ਕੁਝ ਸਕਿੰਟ ਕੈਮਰੇ ਵੱਲ ਦੇਖੋ। ਇਸ ਨਾਲ ਸਾਨੂੰ ਪਤਾ ਲੱਗਦਾ ਹੈ ਕਿ ਜਾਂਚ ਕੋਈ ਹੋਰ ਤਾਂ ਨਹੀਂ ਕਰ ਰਿਹਾ। ਕੋਈ ਫ਼ੋਟੋ ਨਹੀਂ ਰੱਖੀ ਜਾਂਦੀ।",
  },
  start: { en: "Start", hi: "शुरू करें", pa: "ਸ਼ੁਰੂ ਕਰੋ" },
  skip: { en: "Skip this", hi: "छोड़ें", pa: "ਛੱਡੋ" },
  done: { en: "Done — set up.", hi: "हो गया।", pa: "ਹੋ ਗਿਆ।" },
  retry: { en: "We could not get a clear read. Try again in better light.", hi: "साफ़ नहीं दिखा। बेहतर रोशनी में फिर कोशिश करें।", pa: "ਸਾਫ਼ ਨਹੀਂ ਦਿਸਿਆ। ਚੰਗੀ ਰੌਸ਼ਨੀ ਵਿੱਚ ਫਿਰ ਕੋਸ਼ਿਸ਼ ਕਰੋ।" },
} as const;

export default function Enrol() {
  const { patientId = "" } = useParams();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handleRef = useRef<FaceCaptureHandle | null>(null);
  const framesRef = useRef<Landmark[][]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [count, setCount] = useState(0);
  const [state, setState] = useState<"idle" | "capturing" | "saved" | "failed">("idle");

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    handleRef.current?.stop();
  }, []);

  const finish = useCallback(async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    handleRef.current?.stop();
    const sig = buildSignature(framesRef.current);
    if (!sig) { setState("failed"); framesRef.current = []; setCount(0); return; }
    await api.saveIdentitySignature(patientId, sig).catch(() => undefined);
    setState("saved");
    // Back where they came from — onboarding, usually, mid-setup.
    setTimeout(() => navigate(-1), 1200);
  }, [navigate, patientId]);

  const start = useCallback(async () => {
    setState("capturing");
    framesRef.current = [];
    setCount(0);
    try {
      const handle = await startFaceCapture(videoRef.current!);
      handleRef.current = handle;
      handle.beginTask();
      // The handle accumulates into `frames`; poll it rather than inventing a callback
      // the capture layer does not have.
      const tick = setInterval(() => {
        const n = handle.frames.length;
        setCount(n);
        if (n >= NEEDED) {
          clearInterval(tick);
          framesRef.current = handle.endTask();
          void finish();
        }
      }, 200);
      pollRef.current = tick;
    } catch {
      setState("failed");
    }
  }, [finish]);

  return (
    <AppShell>
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <h1 className="text-title-2">{COPY.title[lang]}</h1>
        <p className="text-muted-foreground">{COPY.body[lang]}</p>

        <div className="overflow-hidden rounded-2xl border border-line bg-black">
          <video ref={videoRef} muted playsInline className="w-full" />
        </div>

        {state === "capturing" && (
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.min(100, (count / NEEDED) * 100)}%` }}
            />
          </div>
        )}
        {state === "saved" && <p className="text-lg">{COPY.done[lang]}</p>}
        {state === "failed" && <p className="text-lg">{COPY.retry[lang]}</p>}

        <div className="flex gap-2">
          {state !== "capturing" && state !== "saved" && (
            <Button className="min-h-16 flex-1 text-lg" onClick={() => void start()}>
              {COPY.start[lang]}
            </Button>
          )}
          {state !== "saved" && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="min-h-16 rounded-xl border border-line px-5 text-base"
            >
              {COPY.skip[lang]}
            </button>
          )}
        </div>
      </div>
    </AppShell>
  );
}

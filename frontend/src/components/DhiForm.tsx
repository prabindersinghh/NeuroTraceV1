/**
 * Dizziness Handicap Inventory — 25 items, monthly.
 *
 * Added when scope widened to posterior-circulation stroke. For a patient whose deficits
 * are vertigo and imbalance rather than weakness, this is the closest thing to a functional
 * outcome measure we have, and it is a number the treating clinician already knows.
 *
 * Two things this form does that a generic questionnaire component would not:
 *
 *   It asks in the patient's own language, with only three answers. Twenty-five items is a
 *   lot for a tired 82-year-old, so the answers are large targets and the wording is plain.
 *
 *   It reports the score with its own measurement error attached. The published minimum
 *   detectable change is 18 points, so a family seeing 28 one month and 34 the next must be
 *   told that is noise. Showing a bare number invites reading a six-point move as
 *   deterioration.
 */
import { type FormEvent, useMemo, useState } from "react";

import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Button } from "./ui/button";

/** 0 = no, 2 = sometimes, 4 = yes. The DHI's own scale, not a Likert. */
const CHOICES = [
  { value: 0, en: "No", hi: "नहीं", pa: "ਨਹੀਂ" },
  { value: 2, en: "Sometimes", hi: "कभी-कभी", pa: "ਕਦੇ-ਕਦੇ" },
  { value: 4, en: "Yes", hi: "हाँ", pa: "ਹਾਂ" },
] as const;

/** Item order matches the published instrument; the subscale map lives server-side. */
const ITEMS: { en: string; hi: string; pa: string }[] = [
  { en: "Does looking up make your problem worse?", hi: "ऊपर देखने से आपकी तकलीफ़ बढ़ती है?", pa: "ਉੱਪਰ ਦੇਖਣ ਨਾਲ ਤੁਹਾਡੀ ਤਕਲੀਫ਼ ਵਧਦੀ ਹੈ?" },
  { en: "Do you feel frustrated because of your problem?", hi: "अपनी तकलीफ़ के कारण आप परेशान महसूस करते हैं?", pa: "ਆਪਣੀ ਤਕਲੀਫ਼ ਕਾਰਨ ਤੁਸੀਂ ਪਰੇਸ਼ਾਨ ਮਹਿਸੂਸ ਕਰਦੇ ਹੋ?" },
  { en: "Do you restrict travel because of your problem?", hi: "तकलीफ़ के कारण आप सफ़र कम करते हैं?", pa: "ਤਕਲੀਫ਼ ਕਾਰਨ ਤੁਸੀਂ ਸਫ਼ਰ ਘੱਟ ਕਰਦੇ ਹੋ?" },
  { en: "Does walking down a supermarket aisle make it worse?", hi: "दुकान की गली में चलने से तकलीफ़ बढ़ती है?", pa: "ਦੁਕਾਨ ਦੀ ਗਲੀ ਵਿੱਚ ਤੁਰਨ ਨਾਲ ਤਕਲੀਫ਼ ਵਧਦੀ ਹੈ?" },
  { en: "Do you have difficulty getting into or out of bed?", hi: "बिस्तर पर लेटने या उठने में दिक़्क़त होती है?", pa: "ਮੰਜੇ 'ਤੇ ਲੇਟਣ ਜਾਂ ਉੱਠਣ ਵਿੱਚ ਦਿੱਕਤ ਹੁੰਦੀ ਹੈ?" },
  { en: "Does your problem significantly restrict social activity?", hi: "तकलीफ़ से आपका मेल-जोल काफ़ी कम हुआ है?", pa: "ਤਕਲੀਫ਼ ਨਾਲ ਤੁਹਾਡਾ ਮੇਲ-ਜੋਲ ਕਾਫ਼ੀ ਘਟਿਆ ਹੈ?" },
  { en: "Do you have trouble reading because of your problem?", hi: "तकलीफ़ के कारण पढ़ने में दिक़्क़त होती है?", pa: "ਤਕਲੀਫ਼ ਕਾਰਨ ਪੜ੍ਹਨ ਵਿੱਚ ਦਿੱਕਤ ਹੁੰਦੀ ਹੈ?" },
  { en: "Do more ambitious activities make it worse?", hi: "ज़्यादा मेहनत वाले काम से तकलीफ़ बढ़ती है?", pa: "ਜ਼ਿਆਦਾ ਮਿਹਨਤ ਵਾਲੇ ਕੰਮ ਨਾਲ ਤਕਲੀਫ਼ ਵਧਦੀ ਹੈ?" },
  { en: "Are you afraid to leave home without someone?", hi: "बिना किसी के घर से निकलने में डर लगता है?", pa: "ਬਿਨਾਂ ਕਿਸੇ ਦੇ ਘਰੋਂ ਨਿਕਲਣ ਵਿੱਚ ਡਰ ਲੱਗਦਾ ਹੈ?" },
  { en: "Have you been embarrassed in front of others?", hi: "दूसरों के सामने शर्मिंदगी महसूस हुई है?", pa: "ਦੂਜਿਆਂ ਸਾਹਮਣੇ ਸ਼ਰਮਿੰਦਗੀ ਮਹਿਸੂਸ ਹੋਈ ਹੈ?" },
  { en: "Do quick head movements make it worse?", hi: "सिर तेज़ी से हिलाने पर तकलीफ़ बढ़ती है?", pa: "ਸਿਰ ਤੇਜ਼ੀ ਨਾਲ ਹਿਲਾਉਣ 'ਤੇ ਤਕਲੀਫ਼ ਵਧਦੀ ਹੈ?" },
  { en: "Do you avoid heights because of your problem?", hi: "तकलीफ़ के कारण ऊँचाई से बचते हैं?", pa: "ਤਕਲੀਫ਼ ਕਾਰਨ ਉਚਾਈ ਤੋਂ ਬਚਦੇ ਹੋ?" },
  { en: "Does turning over in bed make it worse?", hi: "बिस्तर पर करवट लेने से तकलीफ़ बढ़ती है?", pa: "ਮੰਜੇ 'ਤੇ ਪਾਸਾ ਲੈਣ ਨਾਲ ਤਕਲੀਫ਼ ਵਧਦੀ ਹੈ?" },
  { en: "Is it difficult to do strenuous housework or yardwork?", hi: "घर का भारी काम करना मुश्किल है?", pa: "ਘਰ ਦਾ ਭਾਰਾ ਕੰਮ ਕਰਨਾ ਔਖਾ ਹੈ?" },
  { en: "Are you afraid people think you are intoxicated?", hi: "डर लगता है लोग समझें कि आपने नशा किया है?", pa: "ਡਰ ਲੱਗਦਾ ਹੈ ਲੋਕ ਸਮਝਣ ਕਿ ਤੁਸੀਂ ਨਸ਼ਾ ਕੀਤਾ ਹੈ?" },
  { en: "Is it difficult to go for a walk by yourself?", hi: "अकेले टहलने जाना मुश्किल है?", pa: "ਇਕੱਲੇ ਸੈਰ ਕਰਨ ਜਾਣਾ ਔਖਾ ਹੈ?" },
  { en: "Does walking down a footpath make it worse?", hi: "फ़ुटपाथ पर चलने से तकलीफ़ बढ़ती है?", pa: "ਫ਼ੁੱਟਪਾਥ 'ਤੇ ਤੁਰਨ ਨਾਲ ਤਕਲੀਫ਼ ਵਧਦੀ ਹੈ?" },
  { en: "Is it difficult to concentrate?", hi: "ध्यान लगाना मुश्किल होता है?", pa: "ਧਿਆਨ ਲਾਉਣਾ ਔਖਾ ਹੁੰਦਾ ਹੈ?" },
  { en: "Is it difficult to walk around the house in the dark?", hi: "अँधेरे में घर में चलना मुश्किल है?", pa: "ਹਨੇਰੇ ਵਿੱਚ ਘਰ ਵਿੱਚ ਤੁਰਨਾ ਔਖਾ ਹੈ?" },
  { en: "Are you afraid to stay home alone?", hi: "घर में अकेले रहने से डर लगता है?", pa: "ਘਰ ਵਿੱਚ ਇਕੱਲੇ ਰਹਿਣ ਤੋਂ ਡਰ ਲੱਗਦਾ ਹੈ?" },
  { en: "Do you feel handicapped by your problem?", hi: "इस तकलीफ़ से आप लाचार महसूस करते हैं?", pa: "ਇਸ ਤਕਲੀਫ਼ ਨਾਲ ਤੁਸੀਂ ਲਾਚਾਰ ਮਹਿਸੂਸ ਕਰਦੇ ਹੋ?" },
  { en: "Has it placed stress on your relationships?", hi: "इससे रिश्तों पर तनाव आया है?", pa: "ਇਸ ਨਾਲ ਰਿਸ਼ਤਿਆਂ 'ਤੇ ਤਣਾਅ ਆਇਆ ਹੈ?" },
  { en: "Are you depressed because of your problem?", hi: "इस तकलीफ़ से आप उदास रहते हैं?", pa: "ਇਸ ਤਕਲੀਫ਼ ਨਾਲ ਤੁਸੀਂ ਉਦਾਸ ਰਹਿੰਦੇ ਹੋ?" },
  { en: "Does it interfere with your job or responsibilities?", hi: "इससे आपके काम या ज़िम्मेदारियों में रुकावट आती है?", pa: "ਇਸ ਨਾਲ ਤੁਹਾਡੇ ਕੰਮ ਜਾਂ ਜ਼ਿੰਮੇਵਾਰੀਆਂ ਵਿੱਚ ਰੁਕਾਵਟ ਆਉਂਦੀ ਹੈ?" },
  { en: "Does bending over make it worse?", hi: "झुकने से तकलीफ़ बढ़ती है?", pa: "ਝੁਕਣ ਨਾਲ ਤਕਲੀਫ਼ ਵਧਦੀ ਹੈ?" },
];

/** Jacobson & Newman. 16 is the minimum detectable change, so below it is not handicap. */
const BANDS: { max: number; en: string; hi: string; pa: string }[] = [
  { max: 16, en: "no handicap", hi: "कोई बाधा नहीं", pa: "ਕੋਈ ਰੁਕਾਵਟ ਨਹੀਂ" },
  { max: 36, en: "mild", hi: "हल्की", pa: "ਹਲਕੀ" },
  { max: 54, en: "moderate", hi: "मध्यम", pa: "ਦਰਮਿਆਨੀ" },
  { max: 101, en: "severe", hi: "गंभीर", pa: "ਗੰਭੀਰ" },
];

/** Published minimum detectable change. A smaller move is inside the instrument's noise. */
const MDC_POINTS = 18;

export function DhiForm({
  patientId,
  previousTotal,
  onSubmitted,
}: {
  patientId: string;
  previousTotal?: number | null;
  onSubmitted?: (total: number) => void;
}) {
  const { t, lang } = useI18n();
  const [answers, setAnswers] = useState<(number | null)[]>(
    () => Array(ITEMS.length).fill(null),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ total: number; band: string } | null>(null);

  const answered = answers.filter((a) => a !== null).length;
  const complete = answered === ITEMS.length;

  const runningTotal = useMemo(
    () => answers.reduce<number>((sum, a) => sum + (a ?? 0), 0),
    [answers],
  );

  const bandFor = (total: number) =>
    BANDS.find((b) => total < b.max) ?? BANDS[BANDS.length - 1];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!complete) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.submitQuestionnaire(
        patientId, "DHI", answers as number[]);
      const total = Number(res.total ?? runningTotal);
      setResult({ total, band: String(res.band ?? bandFor(total).en) });
      onSubmitted?.(total);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dhiSaveError"));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const change =
      typeof previousTotal === "number" ? result.total - previousTotal : null;
    // The whole reason this component exists rather than a generic score readout.
    const meaningful = change !== null && Math.abs(change) >= MDC_POINTS;

    return (
      <section className="space-y-3">
        <h3 className="text-base font-semibold">{t("dhiTitle")}</h3>
        <p className="text-3xl font-semibold tabular-nums">
          {result.total}
          <span className="ml-1 text-base font-normal text-muted-foreground">/ 100</span>
        </p>
        <p className="text-sm">{bandFor(result.total)[lang]}</p>

        {change !== null && (
          <p
            className={
              meaningful
                ? "rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                : "rounded-md border bg-muted/40 p-2.5 text-sm text-muted-foreground"
            }
          >
            {t("dhiSinceLast").replace("{delta}", `${change > 0 ? "+" : ""}${change}`)}{" "}
            {meaningful
              ? t("dhiMeaningful")
              : t("dhiWithinNoise").replace("{mdc}", String(MDC_POINTS))}
          </p>
        )}

        <p className="text-xs text-muted-foreground">{t("dhiFooter")}</p>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <header className="space-y-1">
        <h3 className="text-base font-semibold">{t("dhiTitle")}</h3>
        {/* The count comes from ITEMS, not a literal — the copy used to say "25" beside a
            progress bar that counted the real length, so the two could disagree. */}
        <p className="text-sm text-muted-foreground">
          {t("dhiIntro").replace("{n}", String(ITEMS.length))}
        </p>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={answered}
          aria-valuemin={0}
          aria-valuemax={ITEMS.length}
        >
          <div
            className="h-full bg-sky-600 transition-all"
            style={{ width: `${(answered / ITEMS.length) * 100}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("dhiAnswered")
            .replace("{done}", String(answered))
            .replace("{total}", String(ITEMS.length))}
        </p>
      </header>

      <ol className="space-y-4">
        {ITEMS.map((item, index) => (
          <li key={index} className="space-y-2">
            <p className="text-sm">
              <span className="mr-1.5 text-muted-foreground">{index + 1}.</span>
              {item[lang]}
            </p>
            <div className="flex gap-2">
              {CHOICES.map((choice) => {
                const selected = answers[index] === choice.value;
                return (
                  <button
                    key={choice.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setAnswers((prev) => {
                        const next = [...prev];
                        next[index] = choice.value;
                        return next;
                      })
                    }
                    // Large targets: the reader may be 82 and unsteady.
                    className={[
                      "min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm transition",
                      selected
                        ? "border-sky-600 bg-sky-600 text-white"
                        : "hover:bg-muted",
                    ].join(" ")}
                  >
                    {choice[lang]}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={!complete || busy} className="w-full">
        {busy
          ? t("dhiSaving")
          : complete
            ? t("dhiSave")
            : t("dhiLeft").replace("{n}", String(ITEMS.length - answered))}
      </Button>
    </form>
  );
}

export default DhiForm;

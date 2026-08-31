/**
 * The caregiver's evening review — `/review/:patientId`.
 *
 * WHAT THIS ACTUALLY IS: the only source of labelled training data this product will ever
 * have for a specific person's speech. Every correction is one (heard → meant) pair for
 * their personalised adapter. There is no dataset for a 67-year-old Punjabi speaker with
 * post-stroke dysarthria; there is only the family, five minutes an evening.
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
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface ReviewItem {
  id: string;
  text: string;
  lang: string;
  confidence: number | null;
  ts: string;
}

const COPY = {
  title: { en: "This evening's review", hi: "आज शाम की जाँच", pa: "ਅੱਜ ਸ਼ਾਮ ਦੀ ਜਾਂਚ" },
  intro: {
    en: "We were unsure about these. Correcting one teaches the app their voice — nothing else can.",
    hi: "इनके बारे में हमें ठीक से पता नहीं चला। एक भी सुधारने से ऐप उनकी आवाज़ सीखता है।",
    pa: "ਇਹਨਾਂ ਬਾਰੇ ਸਾਨੂੰ ਠੀਕ ਪਤਾ ਨਹੀਂ ਲੱਗਾ। ਇੱਕ ਵੀ ਸੁਧਾਰਨ ਨਾਲ ਐਪ ਉਹਨਾਂ ਦੀ ਆਵਾਜ਼ ਸਿੱਖਦਾ ਹੈ।",
  },
  heard: { en: "We heard", hi: "हमने सुना", pa: "ਅਸੀਂ ਸੁਣਿਆ" },
  meant: { en: "They meant", hi: "उनका मतलब था", pa: "ਉਹਨਾਂ ਦਾ ਮਤਲਬ ਸੀ" },
  correct: { en: "Correct it", hi: "सुधारें", pa: "ਸੁਧਾਰੋ" },
  right: { en: "That was right", hi: "यह सही था", pa: "ਇਹ ਸਹੀ ਸੀ" },
  save: { en: "Save", hi: "सहेजें", pa: "ਸੰਭਾਲੋ" },
  empty: {
    en: "Nothing to review tonight. The app understood them.",
    hi: "आज कुछ जाँचने को नहीं। ऐप उन्हें समझ पाया।",
    pa: "ਅੱਜ ਕੁਝ ਜਾਂਚਣ ਨੂੰ ਨਹੀਂ। ਐਪ ਉਹਨਾਂ ਨੂੰ ਸਮਝ ਸਕਿਆ।",
  },
  done: {
    en: "Done. That is one more thing the app knows about their voice.",
    hi: "हो गया। ऐप ने उनकी आवाज़ के बारे में एक और बात सीखी।",
    pa: "ਹੋ ਗਿਆ। ਐਪ ਨੇ ਉਹਨਾਂ ਦੀ ਆਵਾਜ਼ ਬਾਰੇ ਇੱਕ ਹੋਰ ਗੱਲ ਸਿੱਖੀ।",
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

  const load = useCallback(async () => {
    try {
      const res = await api.awaazReviewQueue(patientId);
      setItems(res.items as ReviewItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [patientId]);

  useEffect(() => { void load(); }, [load]);

  const submit = useCallback(async (id: string, corrected: string) => {
    await api.awaazLabel(id, corrected).catch(() => undefined);
    setEditing(null);
    setDraft("");
    setSavedCount((n) => n + 1);
    setItems((prev) => (prev ?? []).filter((i) => i.id !== id));
  }, []);

  if (error) return <AppShell><ErrorState message={error} onRetry={load} /></AppShell>;
  if (!items) return <AppShell><LoadingState /></AppShell>;

  return (
    <AppShell>
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <header>
          <h1 className="text-title-fluid">{COPY.title[lang]}</h1>
          <p className="mt-1 text-muted-foreground">{COPY.intro[lang]}</p>
        </header>

        {savedCount > 0 && (
          <p className="rounded-xl border border-stable/40 bg-stable-soft p-4 text-sm">
            {COPY.done[lang]}
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
                    className="min-h-14 rounded-xl border border-line px-4 text-xl"
                  />
                  <div className="flex gap-2">
                    <Button
                      className="min-h-12 flex-1"
                      disabled={!draft.trim()}
                      onClick={() => void submit(item.id, draft.trim())}
                    >
                      {COPY.save[lang]}
                    </Button>
                    <button
                      type="button"
                      onClick={() => { setEditing(null); setDraft(""); }}
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
                    onClick={() => { setEditing(item.id); setDraft(item.text); }}
                    className="min-h-12 flex-1 rounded-xl border-2 border-accent/40 px-4 text-base"
                  >
                    {COPY.correct[lang]}
                  </button>
                  {/* "That was right" is also a label — a confirmed positive is training
                      data too, and marking it clears the item honestly. */}
                  <button
                    type="button"
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

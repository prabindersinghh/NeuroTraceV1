/**
 * The caregiver's evening review — `/review/:patientId`.
 *
 * WHAT THIS ACTUALLY IS: a short queue where a caregiver verifies what the person meant.
 * The saved text labels can support future personalisation, but this screen does not
 * pretend a text-only correction is already an audio training pair.
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
    setSavingId(id);
    setSaveError(null);
    try {
      await api.awaazLabel(id, corrected);
      setEditing(null);
      setDraft("");
      setSavedCount((n) => n + 1);
      setItems((prev) => (prev ?? []).filter((i) => i.id !== id));
    } catch {
      // Keep the item and the draft. A failed label is a retry, never a training pair.
      setSaveError(COPY.failed[lang]);
    } finally {
      setSavingId(null);
    }
  }, [lang]);

  if (error) return <AppShell><ErrorState message={error} onRetry={load} /></AppShell>;
  if (!items) return <AppShell><LoadingState /></AppShell>;

  return (
    <AppShell>
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <header>
          <h1 className="text-2xl font-semibold">{COPY.title[lang]}</h1>
          <p className="mt-1 text-muted-foreground">{COPY.intro[lang]}</p>
        </header>

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
                    className="min-h-14 rounded-xl border border-line px-4 text-xl"
                  />
                  <div className="flex gap-2">
                    <Button
                      className="min-h-12 flex-1"
                      disabled={!draft.trim() || savingId === item.id}
                      onClick={() => void submit(item.id, draft.trim())}
                    >
                      {COPY.save[lang]}
                    </Button>
                    <button
                      type="button"
                      onClick={() => { setEditing(null); setDraft(""); }}
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
                    disabled={savingId === item.id}
                    onClick={() => { setEditing(item.id); setDraft(item.text); }}
                    className="min-h-12 flex-1 rounded-xl border-2 border-accent/40 px-4 text-base"
                  >
                    {COPY.correct[lang]}
                  </button>
                  {/* "That was right" is also a verified text label and clears the item. */}
                  <button
                    type="button"
                    disabled={savingId === item.id}
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

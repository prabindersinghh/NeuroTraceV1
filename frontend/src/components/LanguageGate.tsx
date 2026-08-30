/**
 * The first screen: choose a language — Part 2.
 *
 * WHY IT COMES BEFORE EVERYTHING, INCLUDING THE DEMO. The old default was English,
 * silently, and nothing ever asked. A Punjabi-speaking household could reach the exam
 * without being offered anything else, because the only language control lived inside
 * screens they had to read English to get through. Asking first costs one tap and removes
 * that whole class of problem.
 *
 * It renders only when nobody has chosen yet (`hasChosenLang()`), so it is a first-run
 * screen and not a gate a returning patient has to clear every morning.
 *
 * EACH OPTION IS WRITTEN IN ITS OWN LANGUAGE, and nothing else on this screen is
 * translated. Someone who cannot read English must be able to find their language without
 * first reading a prompt in a language they do not have — so the prompt is the three names
 * themselves, in their own scripts, at patient scale. There is deliberately no heading
 * sentence to mistranslate.
 */
import type { Lang } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

/** Name of each language, in that language. Never translated. */
const CHOICES: { lang: Lang; label: string; hint: string }[] = [
  { lang: "en", label: "English", hint: "English" },
  { lang: "hi", label: "हिंदी", hint: "Hindi" },
  { lang: "pa", label: "ਪੰਜਾਬੀ", hint: "Punjabi" },
];

export function LanguageGate({ onChosen }: { onChosen: () => void }) {
  const { setLang } = useI18n();

  return (
    <main className="patient-scale mx-auto flex min-h-screen w-full max-w-xl flex-col
                     justify-center gap-8 px-5 py-10">
      <div className="text-center">
        {/* The product name, not a sentence: it is the one word on this screen that is the
            same in every language. */}
        <p className="text-2xl font-semibold tracking-tight">NeuroTrace</p>
        {/* A globe rather than words. The three buttons ARE the question. */}
        <p className="mt-2 text-4xl" aria-hidden>🌐</p>
      </div>

      <ul className="flex flex-col gap-4">
        {CHOICES.map(({ lang, label, hint }) => (
          <li key={lang}>
            <button
              type="button"
              lang={lang}
              onClick={() => { setLang(lang); onChosen(); }}
              className="flex min-h-16 w-full items-center justify-center rounded-2xl
                         border-2 border-line bg-surface px-6 text-2xl font-medium
                         focus-visible:outline focus-visible:outline-2
                         focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {/* The visible label is the native name; the accessible name adds the
                  English exonym so a screen reader set to English still announces
                  something its user can act on. */}
              <span aria-hidden>{label}</span>
              <span className="sr-only">{`${label} — ${hint}`}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="text-center text-base text-muted-foreground">
        {/* Written in all three at once, because at this moment we do not yet know which
            one the reader has. Short enough to stay legible at patient scale. */}
        You can change this later · बाद में बदल सकते हैं · ਬਾਅਦ ਵਿੱਚ ਬਦਲ ਸਕਦੇ ਹੋ
      </p>
    </main>
  );
}

export default LanguageGate;

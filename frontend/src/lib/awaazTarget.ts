/**
 * Which patient the header's Awaaz link points at.
 *
 * THE PROBLEM THIS SOLVES. `/awaaz/:patientId` needs an id, and `AppShell` renders on
 * every authenticated screen — including the three that carry no `:patientId` at all
 * (`PatientHome`, `CaregiverHome`, `Clinic`). Before this, Awaaz was reachable from
 * exactly one link in `PatientHome`, so a caregiver or clinician could not open the
 * communication board at all, and the patient could only reach it from one screen.
 *
 * WHY NOT JUST FETCH THE ROSTER IN THE HEADER. That would add a `GET /patients` to every
 * page view, on a product whose target device is a cheap handset on an intermittent
 * connection, to render one link. The id is already in hand on every screen that has one:
 * the route params, or the roster the screen just loaded. So the header reads what is
 * already known and remembers it, and costs no request.
 *
 * SCOPE, DELIBERATELY: this decides what to LINK TO, never what may be opened. INV-6 puts
 * authorisation server-side on `/awaaz/{id}`, so a remembered id that no longer belongs to
 * this user gets a 403 from the API, not a leak. Nothing here is a permission check, and
 * the remembered value is an opaque UUID — no name, no clinical value (INV-11).
 */
import { useEffect } from "react";
import { useParams } from "react-router-dom";

const KEY = "neurotrace.awaaz.patient";

/** A v4-shaped UUID and nothing else, so a stale or hand-edited value cannot build a URL. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function rememberAwaazPatient(id: string | null | undefined): void {
  if (!id || !UUID.test(id)) return;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private mode, or storage full. The link falls back to route params; not worth a throw.
  }
}

export function readAwaazPatient(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw && UUID.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Cleared on sign-out: the next person to use this handset is often a different patient. */
export function forgetAwaazPatient(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * The id to link to, or null when nothing is known yet — in which case the caller renders
 * no Awaaz control rather than a link that would 404.
 *
 * Route params win over the remembered value, so opening a second patient's dashboard
 * moves the header with it instead of pointing back at the first.
 */
export function useAwaazTarget(): string | null {
  const { patientId } = useParams<{ patientId?: string }>();
  const fromRoute = patientId && UUID.test(patientId) ? patientId : null;

  useEffect(() => {
    if (fromRoute) rememberAwaazPatient(fromRoute);
  }, [fromRoute]);

  return fromRoute ?? readAwaazPatient();
}

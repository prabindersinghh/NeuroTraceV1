import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { LanguageGate } from "@/components/LanguageGate";
import { LoadingState } from "@/components/ui/states";
import { useAuth } from "@/lib/auth";
import { hasChosenLang } from "@/lib/langStorage";
import Landing from "@/routes/Landing";
import { Login } from "@/routes/Login";

/**
 * Everything behind the sign-in wall is code-split.
 *
 * These were all static imports, which put the exam capture path, the MediaPipe wrapper,
 * the recharts dashboard and every clinician surface into ONE chunk with the public
 * landing page: a visitor who arrived to read about the product downloaded the entire
 * clinical application before the hero painted. Splitting at the route is the correct
 * seam because nothing outside a route references these modules.
 *
 * `Landing` and `Login` stay eager on purpose — they are the two first paints for a
 * signed-out visitor, and deferring them would trade a large download for a blank frame
 * plus a second round trip, which is worse on exactly the connections this is built for.
 */
const CaregiverHome = lazy(() => import("@/routes/CaregiverHome").then((m) => ({ default: m.CaregiverHome })));
const CaretakerHome = lazy(() => import("@/routes/CaretakerHome").then((m) => ({ default: m.CaretakerHome })));
const FamilyAccess = lazy(() => import("@/routes/FamilyAccess").then((m) => ({ default: m.FamilyAccess })));
const Clinic = lazy(() => import("@/routes/Clinic").then((m) => ({ default: m.Clinic })));
const ClinicianReport = lazy(() => import("@/routes/ClinicianReport"));
const Dashboard = lazy(() => import("@/routes/Dashboard").then((m) => ({ default: m.Dashboard })));
const Diagnostics = lazy(() => import("@/routes/Diagnostics"));
const Awaaz = lazy(() => import("@/routes/Awaaz"));
const Onboarding = lazy(() => import("@/routes/Onboarding"));
const Exam = lazy(() => import("@/routes/Exam").then((m) => ({ default: m.Exam })));
const ExamPractice = lazy(() => import("@/routes/Exam").then((m) => ({ default: m.ExamPractice })));
const PatientHome = lazy(() => import("@/routes/PatientHome").then((m) => ({ default: m.PatientHome })));
const Register = lazy(() => import("@/routes/Register").then((m) => ({ default: m.Register })));
const Enrol = lazy(() => import("@/routes/Enrol"));
const Listen = lazy(() => import("@/routes/Listen"));
const ReviewQueue = lazy(() => import("@/routes/ReviewQueue"));
const Admin = lazy(() => import("@/routes/Admin"));

/**
 * The page-change transition.
 *
 * Deliberately NOT `key={pathname}` on the router outlet, which is the usual recipe: that
 * remounts the whole subtree on every navigation, so a dashboard refetches and any
 * in-progress exam state is thrown away. This replays a CSS animation on a stable wrapper
 * instead — the DOM is untouched, and a route that renders the same component with a new
 * param keeps its identity.
 *
 * Reduced motion is covered by the global backstop in index.css.
 */
function RouteTransition({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("route-in");
    void el.offsetWidth; // one forced reflow, to restart the animation
    el.classList.add("route-in");
  }, [pathname]);
  return <div ref={ref} className="route-in">{children}</div>;
}

function LandingOrHome() {
  const { user, ready } = useAuth();
  if (!ready) return <LoadingState />;
  // Signed out, the root is the public landing page; signed in, it is the product.
  if (!user) return <Landing />;
  // An admin has no patients of their own, so Home would show them an empty caregiver
  // screen. Send them to the operator console instead.
  if (user.role === "admin") return <Navigate to="/admin" replace />;
  return <Home />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <LoadingState />;
  // Remember where they were going. A caregiver who opened a dashboard link from a
  // message used to land on the home screen after signing in and had to find it again;
  // the sign-in screen validates this before honouring it (`safeReturnPath`).
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** Role decides the landing page: a patient gets one button, a clinician gets the list. */
function Home() {
  const { user } = useAuth();
  if (user?.role === "patient") return <PatientHome />;
  if (user?.role === "clinician") return <Clinic />;
  // Family, ADDITIONAL to the caregiver who enrolled the patient (D-054). Before this
  // branch a caretaker fell through to CaregiverHome and was shown an "add a patient" form
  // and an enrolment flow that 403s — a control that cannot work reads as a broken product
  // rather than a boundary.
  if (user?.role === "caretaker") return <CaretakerHome />;
  return <CaregiverHome />;
}

export default function App() {
  // First run only: nobody has picked a language yet. Held in state as well as storage so
  // the choice takes effect immediately rather than on the next load.
  const [needsLang, setNeedsLang] = useState(() => !hasChosenLang());
  if (needsLang) return <LanguageGate onChosen={() => setNeedsLang(false)} />;

  return (
    // One boundary for every split route. The exam is the only surface where a spinner
    // is a real cost, and its chunk is fetched while the caregiver is still on the home
    // screen deciding to start.
    <Suspense fallback={<LoadingState />}>
      <RouteTransition>
        <Routes>
          {/* No auth guard: this is run on a strange phone before anyone has an account,
              and it neither reads nor writes patient data. */}
          <Route path="/diagnostics" element={<Diagnostics />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<LandingOrHome />} />
          <Route path="/clinic" element={<RequireAuth><Clinic /></RequireAuth>} />
          <Route path="/report/:patientId" element={<RequireAuth><ClinicianReport /></RequireAuth>} />
          <Route path="/exam/:patientId" element={<RequireAuth><Exam /></RequireAuth>} />
          {/* No auth guard: a listener link is opened by a stranger with no account. */}
          <Route path="/listen/:token" element={<Listen />} />
          <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
          <Route path="/enrol/:patientId" element={<RequireAuth><Enrol /></RequireAuth>} />
          <Route path="/review/:patientId" element={<RequireAuth><ReviewQueue /></RequireAuth>} />
          <Route path="/awaaz/:patientId" element={<RequireAuth><Awaaz /></RequireAuth>} />
          <Route path="/onboarding/:patientId" element={<RequireAuth><Onboarding /></RequireAuth>} />
          <Route path="/exam/:patientId/practice" element={<RequireAuth><ExamPractice /></RequireAuth>} />
          <Route path="/family/:patientId" element={<RequireAuth><FamilyAccess /></RequireAuth>} />
          <Route path="/dashboard/:patientId" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </RouteTransition>
    </Suspense>
  );
}

import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { LoadingState } from "@/components/ui/states";
import { useAuth } from "@/lib/auth";
import Landing from "@/routes/Landing";
import Awaaz from "@/routes/Awaaz";
import Onboarding from "@/routes/Onboarding";
import { Exam, ExamPractice } from "@/routes/Exam";
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

function LandingOrHome() {
  const { user, ready } = useAuth();
  if (!ready) return <LoadingState />;
  // Signed out, the root is the public landing page; signed in, it is the product.
  if (!user) return <Landing />;
  return <Home />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <LoadingState />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Role decides the landing page: a patient gets one button, a clinician gets the list. */
function Home() {
  const { user } = useAuth();
  if (user?.role === "patient") return <PatientHome />;
  if (user?.role === "clinician") return <Clinic />;
  return <CaregiverHome />;
}

export default function App() {
  return (
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
      <Route path="/awaaz/:patientId" element={<RequireAuth><Awaaz /></RequireAuth>} />
      <Route path="/onboarding/:patientId" element={<RequireAuth><Onboarding /></RequireAuth>} />
      <Route path="/exam/:patientId/practice" element={<RequireAuth><ExamPractice /></RequireAuth>} />
      <Route path="/dashboard/:patientId" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

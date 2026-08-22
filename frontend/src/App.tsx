import { Navigate, Route, Routes } from "react-router-dom";

import { LoadingState } from "@/components/ui/states";
import { useAuth } from "@/lib/auth";
import { CaregiverHome } from "@/routes/CaregiverHome";
import { Clinic } from "@/routes/Clinic";
import ClinicianReport from "@/routes/ClinicianReport";
import { Dashboard } from "@/routes/Dashboard";
import Diagnostics from "@/routes/Diagnostics";
import { Exam } from "@/routes/Exam";
import { Login } from "@/routes/Login";
import { PatientHome } from "@/routes/PatientHome";
import { Register } from "@/routes/Register";

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
      <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
      <Route path="/clinic" element={<RequireAuth><Clinic /></RequireAuth>} />
      <Route path="/report/:patientId" element={<RequireAuth><ClinicianReport /></RequireAuth>} />
      <Route path="/exam/:patientId" element={<RequireAuth><Exam /></RequireAuth>} />
      <Route path="/dashboard/:patientId" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

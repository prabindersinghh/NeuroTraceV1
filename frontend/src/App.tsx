import { Navigate, Route, Routes } from "react-router-dom";
import { LoadingState } from "@/components/ui/states";
import { useAuth } from "@/lib/auth";
import { CaregiverHome } from "@/routes/CaregiverHome";
import { Checkin } from "@/routes/Checkin";
import { Dashboard } from "@/routes/Dashboard";
import { Login } from "@/routes/Login";
import { PatientHome } from "@/routes/PatientHome";
import { Register } from "@/routes/Register";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <LoadingState />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Home() {
  const { user } = useAuth();
  return user?.role === "patient" ? <PatientHome /> : <CaregiverHome />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Home />
          </RequireAuth>
        }
      />
      <Route
        path="/caregiver"
        element={
          <RequireAuth>
            <CaregiverHome />
          </RequireAuth>
        }
      />
      <Route
        path="/checkin/:patientId"
        element={
          <RequireAuth>
            <Checkin />
          </RequireAuth>
        }
      />
      <Route
        path="/dashboard/:patientId"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

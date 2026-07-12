import "@/App.css";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider, useAuth } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";

import LandingPage from "@/pages/marketing/LandingPage";
import PricingPage from "@/pages/marketing/PricingPage";
import LoginPage from "@/pages/auth/LoginPage";
import RegisterPage from "@/pages/auth/RegisterPage";
import ForgotPasswordPage from "@/pages/auth/ForgotPasswordPage";
import AppShell from "@/pages/app/AppShell";
import DashboardPage from "@/pages/app/DashboardPage";
import StudentsPage from "@/pages/app/StudentsPage";
import ParentsPage from "@/pages/app/ParentsPage";
import TeachersPage from "@/pages/app/TeachersPage";
import CoursesPage from "@/pages/app/CoursesPage";
import GroupsPage from "@/pages/app/GroupsPage";
import SessionsPage from "@/pages/app/SessionsPage";
import AttendancePage from "@/pages/app/AttendancePage";
import PaymentsPage from "@/pages/app/PaymentsPage";
import ReportsPage from "@/pages/app/ReportsPage";
import SettingsPage from "@/pages/app/SettingsPage";
import UsersPage from "@/pages/app/UsersPage";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <ThemeProvider>
        <I18nProvider>
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                {/* Marketing */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/pricing" element={<PricingPage />} />

                {/* Auth */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />

                {/* App (tenant workspace) */}
                <Route
                  path="/app"
                  element={
                    <RequireAuth>
                      <AppShell />
                    </RequireAuth>
                  }
                >
                  <Route index element={<Navigate to="dashboard" replace />} />
                  <Route path="dashboard" element={<DashboardPage />} />
                  <Route path="students" element={<StudentsPage />} />
                  <Route path="parents" element={<ParentsPage />} />
                  <Route path="teachers" element={<TeachersPage />} />
                  <Route path="courses" element={<CoursesPage />} />
                  <Route path="groups" element={<GroupsPage />} />
                  <Route path="sessions" element={<SessionsPage />} />
                  <Route path="attendance" element={<AttendancePage />} />
                  <Route path="payments" element={<PaymentsPage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="users" element={<UsersPage />} />
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              <Toaster richColors position="top-right" />
            </AuthProvider>
          </BrowserRouter>
        </I18nProvider>
      </ThemeProvider>
    </div>
  );
}

export default App;

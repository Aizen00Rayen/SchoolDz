import "@/App.css";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider, useAuth } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { ConfirmProvider } from "@/lib/confirm";

import LandingPage from "@/pages/marketing/LandingPage";
import PricingPage from "@/pages/marketing/PricingPage";
import AboutPage from "@/pages/marketing/AboutPage";
import LoginPage from "@/pages/auth/LoginPage";
import RegisterPage from "@/pages/auth/RegisterPage";
import ForgotPasswordPage from "@/pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/auth/ResetPasswordPage";
import OAuthCallbackPage from "@/pages/auth/OAuthCallbackPage";
import BillingGatePage from "@/pages/billing/BillingGatePage";
import BillingSuccessPage from "@/pages/billing/BillingSuccessPage";
import BillingFailurePage from "@/pages/billing/BillingFailurePage";
import AdminLoginPage from "@/pages/admin/AdminLoginPage";
import AdminDashboardPage from "@/pages/admin/AdminDashboardPage";
import AppShell from "@/pages/app/AppShell";
import DashboardPage from "@/pages/app/DashboardPage";
import StudentsPage from "@/pages/app/StudentsPage";
import ParentsPage from "@/pages/app/ParentsPage";
import TeachersPage from "@/pages/app/TeachersPage";
import CoursesPage from "@/pages/app/CoursesPage";
import GroupsPage from "@/pages/app/GroupsPage";
import SessionsPage from "@/pages/app/SessionsPage";
import CalendarPage from "@/pages/app/CalendarPage";
import AttendancePage from "@/pages/app/AttendancePage";
import PaymentsPage from "@/pages/app/PaymentsPage";
import GradesPage from "@/pages/app/GradesPage";
import ReportsPage from "@/pages/app/ReportsPage";
import SettingsPage from "@/pages/app/SettingsPage";
import UsersPage from "@/pages/app/UsersPage";
import MessagesPage from "@/pages/app/MessagesPage";
import PortalShell from "@/pages/portal/PortalShell";
import PortalHomePage from "@/pages/portal/PortalHomePage";
import PortalChildDetailPage from "@/pages/portal/PortalChildDetailPage";
import PortalMessagesPage from "@/pages/portal/PortalMessagesPage";
import EnrollPage from "@/pages/enroll/EnrollPage";
import EnrollSuccessPage from "@/pages/enroll/EnrollSuccessPage";
import EnrollFailurePage from "@/pages/enroll/EnrollFailurePage";

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

/** Same as RequireAuth, but also sends an unpaid tenant to the billing gate
 * instead of the dashboard — there is no free trial, so pending_payment
 * blocks the workspace entirely. Only wraps /app/*; /admin (super admin,
 * no tenant of its own) and /billing itself are unaffected. Also redirects
 * role='parent' users to /portal — they have no business in the staff CRUD
 * tree, and every /app/* endpoint would 403 them anyway. */
function RequireActiveTenant({ children }) {
  const { user, tenant, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (user.role === "parent") return <Navigate to="/portal" replace />;
  if (tenant?.status === "pending_payment") return <Navigate to="/billing" replace />;
  return children;
}

/** Parent-portal counterpart of RequireActiveTenant — only role='parent'
 * users belong here; everyone else (staff, super admin) is sent to /app. */
function RequirePortalAccess({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (user.role !== "parent") return <Navigate to="/app" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <ThemeProvider>
        <I18nProvider>
          <BrowserRouter>
            <AuthProvider>
              <ConfirmProvider>
                <Routes>
                  {/* Marketing */}
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/pricing" element={<PricingPage />} />
                  <Route path="/about" element={<AboutPage />} />

                  {/* Auth */}
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/register" element={<RegisterPage />} />
                  <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/oauth/callback" element={<OAuthCallbackPage />} />

                  {/* Billing */}
                  <Route path="/billing" element={<RequireAuth><BillingGatePage /></RequireAuth>} />
                  <Route path="/billing/success" element={<RequireAuth><BillingSuccessPage /></RequireAuth>} />
                  <Route path="/billing/failure" element={<RequireAuth><BillingFailurePage /></RequireAuth>} />

                  {/* Public self-enrollment (per-school, no login required to view) */}
                  <Route path="/enroll/:slug" element={<EnrollPage />} />
                  <Route path="/enroll/:slug/success" element={<RequireAuth><EnrollSuccessPage /></RequireAuth>} />
                  <Route path="/enroll/:slug/failure" element={<RequireAuth><EnrollFailurePage /></RequireAuth>} />

                  {/* Admin */}
                  <Route path="/admin/login" element={<AdminLoginPage />} />
                  <Route
                    path="/admin"
                    element={
                      <RequireAuth>
                        <AdminDashboardPage />
                      </RequireAuth>
                    }
                  />

                  {/* App (tenant workspace) */}
                  <Route
                    path="/app"
                    element={
                      <RequireActiveTenant>
                        <AppShell />
                      </RequireActiveTenant>
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
                    <Route path="calendar" element={<CalendarPage />} />
                    <Route path="attendance" element={<AttendancePage />} />
                    <Route path="payments" element={<PaymentsPage />} />
                    <Route path="grades" element={<GradesPage />} />
                    <Route path="reports" element={<ReportsPage />} />
                    <Route path="messages" element={<MessagesPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="users" element={<UsersPage />} />
                  </Route>

                  {/* Parent portal */}
                  <Route
                    path="/portal"
                    element={
                      <RequirePortalAccess>
                        <PortalShell />
                      </RequirePortalAccess>
                    }
                  >
                    <Route index element={<PortalHomePage />} />
                    <Route path="children/:studentId" element={<PortalChildDetailPage />} />
                    <Route path="messages" element={<PortalMessagesPage />} />
                  </Route>

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
                <Toaster richColors position="bottom-right" />
              </ConfirmProvider>
            </AuthProvider>
          </BrowserRouter>
        </I18nProvider>
      </ThemeProvider>
    </div>
  );
}

export default App;

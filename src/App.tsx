// App — router for the HKU ENGG Intranet demo.
// R1: login + dashboard. R2: Bookings. R3: Leave. R4–R5 pending.
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { BookingsPage } from './pages/Bookings';
import { BookingNew, BookingEdit } from './pages/BookingForm';
import { BookingDetail } from './pages/BookingDetail';
import { LeavePage } from './pages/Leave';
import { LeaveNew, LeaveEdit } from './pages/LeaveForm';
import { LeaveDetail } from './pages/LeaveDetail';
import { TasksPage } from './pages/Tasks';
import { TasksMy } from './pages/TasksMy';
import { TaskNew, TaskEdit } from './pages/TaskForm';
import { TaskDetail } from './pages/TaskDetail';
import { AnnouncementsPage } from './pages/Announcements';
import { AnnouncementNew } from './pages/AnnouncementForm';
import { AnnouncementDetail } from './pages/AnnouncementDetail';
import { NotificationsPage } from './pages/Notifications';
import { ProfilePage } from './pages/Profile';
import { AdminHome } from './pages/AdminHome';
import { AdminRooms } from './pages/AdminRooms';
import { AdminRoomNew, AdminRoomEdit } from './pages/AdminRoomForm';
import { AdminUsers } from './pages/AdminUsers';
import { AdminTaskSettings } from './pages/AdminTaskSettings';
import { AdminHolidays } from './pages/AdminHolidays';
import { AdminDatabase } from './pages/AdminDatabase';
import { AdminBackup } from './pages/AdminBackup';
import { AdminAudit } from './pages/AdminAudit';
import { AdminSystemLogs } from './pages/AdminSystemLogs';
import { ROLE } from './lib/app';

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <AppShell title={title}>
      <div className="page-header">
        <h1>{title}</h1>
      </div>
      <div className="card">
        <div className="empty">{body}</div>
      </div>
    </AppShell>
  );
}

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function RequireRole({
  children,
  allow
}: {
  children: React.ReactElement;
  allow: () => boolean;
}) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  if (!allow()) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<Login />} />

          <Route path="/dashboard" element={
            <RequireAuth><Dashboard /></RequireAuth>
          } />

          <Route path="/bookings" element={
            <RequireAuth><BookingsPage /></RequireAuth>
          } />
          <Route path="/bookings/new" element={
            <RequireAuth><BookingNew /></RequireAuth>
          } />
          <Route path="/bookings/:id/edit" element={
            <RequireAuth><BookingEdit /></RequireAuth>
          } />
          <Route path="/bookings/:id" element={
            <RequireAuth><BookingDetail /></RequireAuth>
          } />

          <Route path="/leave" element={
            <RequireAuth><LeavePage /></RequireAuth>
          } />
          <Route path="/leave/new" element={
            <RequireAuth><LeaveNew /></RequireAuth>
          } />
          <Route path="/leave/:id/edit" element={
            <RequireAuth><LeaveEdit /></RequireAuth>
          } />
          <Route path="/leave/:id" element={
            <RequireAuth><LeaveDetail /></RequireAuth>
          } />

          <Route path="/tasks" element={
            <RequireAuth><TasksPage /></RequireAuth>
          } />
          <Route path="/tasks/mine" element={
            <RequireAuth><TasksMy /></RequireAuth>
          } />
          <Route path="/tasks/new" element={
            <RequireAuth><TaskNew /></RequireAuth>
          } />
          <Route path="/tasks/:id/edit" element={
            <RequireAuth><TaskEdit /></RequireAuth>
          } />
          <Route path="/tasks/:id" element={
            <RequireAuth><TaskDetail /></RequireAuth>
          } />

          <Route path="/announcements" element={
            <RequireAuth><AnnouncementsPage /></RequireAuth>
          } />
          <Route path="/announcements/new" element={
            <RequireAuth><AnnouncementNew /></RequireAuth>
          } />
          <Route path="/announcements/:id" element={
            <RequireAuth><AnnouncementDetail /></RequireAuth>
          } />

          <Route path="/notifications" element={
            <RequireAuth><NotificationsPage /></RequireAuth>
          } />

          <Route path="/profile" element={
            <RequireAuth><ProfilePage /></RequireAuth>
          } />

          {/* Admin */}
          <Route path="/admin" element={
            <RequireRole allow={() => ROLE.isAdmin()}>
              <AdminHome />
            </RequireRole>
          } />
          <Route path="/admin/rooms" element={
            <RequireRole allow={() => ROLE.isAdmin()}>
              <AdminRooms />
            </RequireRole>
          } />
          <Route path="/admin/rooms/new" element={
            <RequireRole allow={() => ROLE.isAdmin()}>
              <AdminRoomNew />
            </RequireRole>
          } />
          <Route path="/admin/rooms/:id/edit" element={
            <RequireRole allow={() => ROLE.isAdmin()}>
              <AdminRoomEdit />
            </RequireRole>
          } />
          <Route path="/admin/users" element={
            <RequireRole allow={() => ROLE.isAdmin()}>
              <AdminUsers />
            </RequireRole>
          } />
          <Route path="/admin/task-settings" element={
            <RequireRole allow={() => ROLE.isAdmin()}>
              <AdminTaskSettings />
            </RequireRole>
          } />
          <Route path="/admin/holidays" element={
            <RequireRole allow={() => ROLE.isAdmin()}>
              <AdminHolidays />
            </RequireRole>
          } />
          <Route path="/admin/sso" element={
            <RequireRole allow={() => ROLE.isAdmin()}>
              <Placeholder title="Identity & SSO" body="SSO admin is awaiting network team input before implementation." />
            </RequireRole>
          } />
          <Route path="/admin/database" element={
            <RequireRole allow={() => ROLE.isAdmin()}>
              <AdminDatabase />
            </RequireRole>
          } />
          <Route path="/admin/backup" element={
            <RequireRole allow={() => ROLE.isAdmin()}>
              <AdminBackup />
            </RequireRole>
          } />

          {/* Audit */}
          <Route path="/admin/audit" element={
            <RequireRole allow={() => ROLE.canSeeAudit()}>
              <AdminAudit />
            </RequireRole>
          } />
          <Route path="/admin/system-logs" element={
            <RequireRole allow={() => ROLE.canSeeAudit()}>
              <AdminSystemLogs />
            </RequireRole>
          } />

          <Route path="*" element={
            <RequireAuth><Placeholder title="Not found" body="That page does not exist." /></RequireAuth>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
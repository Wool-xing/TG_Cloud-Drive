import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth.store';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import DrivePage from './pages/Drive';
import RecentPage from './pages/Recent';
import TrashPage from './pages/Trash';
import StarredPage from './pages/Starred';
import SharesPage from './pages/Shares';
import SharedAccessPage from './pages/SharedAccess';
import ProfilePage from './pages/Profile';
import AdminLayout from './components/admin/AdminLayout';
import AdminDashboard from './pages/admin/Dashboard';
import AdminUsers from './pages/admin/Users';
import AdminFiles from './pages/admin/Files';
import AdminConfig from './pages/admin/Config';
import PrivateSpaceGate from './components/PrivateSpaceGate';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/s/:token" element={<SharedAccessPage />} />

        <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<DrivePage />} />
          <Route path="recent" element={<RecentPage />} />
          <Route path="private" element={<PrivateSpaceGate />} />
          <Route path="trash" element={<TrashPage />} />
          <Route path="starred" element={<StarredPage />} />
          <Route path="shares" element={<SharesPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
          <Route index element={<AdminDashboard />} />
          {/* /admin/dashboard alias — users typing the URL directly expect this path */}
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="files" element={<AdminFiles />} />
          <Route path="config" element={<AdminConfig />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}


import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import ApplicationsPage from './pages/ApplicationsPage';
import KanbanPage from './pages/KanbanPage';
import ReportsPage from './pages/ReportsPage';
import TrashPage from './pages/TrashPage';

// Guard for protected routes
const PrivateRoute = ({ children }) => {
  const { user } = useAuth();
  const location = useLocation();
  return user ? children : <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
};

// Guard for auth routes (redirect if logged in)
const PublicRoute = ({ children }) => {
  const { user } = useAuth();
  return user ? <Navigate to="/dashboard" replace /> : children;
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login"    element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
      <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
      <Route path="/reset-password" element={<PublicRoute><ResetPasswordPage /></PublicRoute>} />
      <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route path="/dashboard"    element={<DashboardPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/kanban"       element={<KanbanPage />} />
        <Route path="/reports"      element={<ReportsPage />} />
        <Route path="/trash"        element={<TrashPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster
  position="top-right"
  toastOptions={{
    duration: 3500,
    style: {
      background: '#111a2b',
      color: '#f8fafc',
      border: '1px solid #24334b',
      borderRadius: '12px',
      padding: '14px 16px',
      fontSize: '14px',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
    },
    success: {
      iconTheme: {
        primary: '#f59e0b',
        secondary: '#080e1b',
      },
    },
    error: {
      iconTheme: {
        primary: '#fb7185',
        secondary: '#080e1b',
      },
    },
  }}
/>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
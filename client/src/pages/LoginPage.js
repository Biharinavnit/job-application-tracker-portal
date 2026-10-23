
import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import PasswordInput from '../components/PasswordInput';

export default function LoginPage() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const { login, loginDemo, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedPath = location.state?.from || new URLSearchParams(location.search).get('returnTo');
  const returnPath = requestedPath?.startsWith('/') && !requestedPath.startsWith('//')
    ? requestedPath
    : '/dashboard';

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const res = await login(form.email, form.password);
    if (res.success) {
      toast.success('Welcome back! ');
      navigate(returnPath, { replace: true });
    } else {
      setError(res.message);
    }
  };

  const demoLogin = async () => {
    setError('');
    const res = await loginDemo();
    if (res.success) {
      toast.success('Logged in as demo user!');
      navigate('/dashboard');
    } else {
      setError(res.message);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg-pattern" />
      <div className="auth-card">
        <div className="auth-logo">
          <div className="logo-mark">
            <div className="logo-icon" style={{ width: 44, height: 44, fontSize: 22 }}>🎯</div>
            <div className="logo-text" style={{ fontSize: 26 }}>Job<span>Track</span></div>
          </div>
        </div>

        <h2 className="auth-title">Welcome back</h2>
        <p className="auth-subtitle">Track your job hunt like a pro.</p>

        {location.state?.passwordResetMessage && (
          <div className="auth-success-msg" role="status">{location.state.passwordResetMessage}</div>
        )}
        {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

        <form className="auth-form" onSubmit={submit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="form-input"
              type="email"
              name="email"
              placeholder="Email address"
              value={form.email}
              onChange={handle}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <div className="auth-field-heading">
              <label className="form-label" htmlFor="login-password">Password</label>
              <Link className="auth-link" to="/forgot-password">Forgot Password?</Link>
            </div>
            <PasswordInput
              id="login-password"
              name="password"
              placeholder="••••••••"
              value={form.password}
              onChange={handle}
              required
            />
          </div>

          <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            {loading ? 'Signing in…' : 'Sign In →'}
          </button>
        </form>

        <button className="btn btn-secondary" type="button" onClick={demoLogin} disabled={loading}
          style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>
           {loading ? 'Signing in…' : 'Try Demo Account'}
        </button>

        <p className="auth-divider" style={{ marginTop: 20 }}>
          Don't have an account?{' '}
          <button className="auth-link" type="button" onClick={() => navigate('/register')}>Sign up free</button>
        </p>
      </div>
    </div>
  );
}
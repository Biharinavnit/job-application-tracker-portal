import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import PasswordInput from '../components/PasswordInput';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!token) {
      setError('This password reset link is invalid or has expired.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/reset-password', { token, password });
      navigate('/login', { replace: true, state: { passwordResetMessage: data.message } });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to reset your password. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg-pattern" />
      <section className="auth-card" aria-labelledby="reset-password-title">
        <div className="auth-logo">
          <div className="logo-mark">
            <div className="logo-icon" style={{ width: 44, height: 44, fontSize: 22 }}>🎯</div>
            <div className="logo-text" style={{ fontSize: 26 }}>Job<span>Track</span></div>
          </div>
        </div>
        <h1 className="auth-title" id="reset-password-title">Set a new password</h1>
        <p className="auth-subtitle">Choose a new password for your JobTrack account.</p>

        {error && <div className="error-msg" role="alert">{error}</div>}

        <form className="auth-form" onSubmit={submit}>
          <div className="form-group">
            <label className="form-label" htmlFor="new-password">New password</label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="confirm-password">Confirm new password</label>
            <PasswordInput
              id="confirm-password"
              autoComplete="new-password"
              minLength={6}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Resetting…' : 'Reset password'}
          </button>
        </form>

        <p className="auth-divider" style={{ marginTop: 20 }}>
          <Link className="auth-link" to="/login">← Return to Login</Link>
        </p>
      </section>
    </div>
  );
}

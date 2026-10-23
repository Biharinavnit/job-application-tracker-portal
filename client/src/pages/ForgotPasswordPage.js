import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setMessage(data.message);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to process your request. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg-pattern" />
      <section className="auth-card" aria-labelledby="forgot-password-title">
        <div className="auth-logo">
          <div className="logo-mark">
            <div className="logo-icon" style={{ width: 44, height: 44, fontSize: 22 }}>🎯</div>
            <div className="logo-text" style={{ fontSize: 26 }}>Job<span>Track</span></div>
          </div>
        </div>
        <h1 className="auth-title" id="forgot-password-title">Forgot your password?</h1>
        <p className="auth-subtitle">Enter your account email. If it is registered, reset instructions may be sent to that address.</p>

        {message && <div className="auth-success-msg" role="status">{message}</div>}
        {error && <div className="error-msg" role="alert">{error}</div>}

        <form className="auth-form" onSubmit={submit}>
          <div className="form-group">
            <label className="form-label" htmlFor="forgot-email">Email</label>
            <input
              className="form-input"
              id="forgot-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Sending…' : 'Send reset instructions'}
          </button>
        </form>

        <p className="auth-divider" style={{ marginTop: 20 }}>
          <Link className="auth-link" to="/login">← Return to Login</Link>
        </p>
      </section>
    </div>
  );
}

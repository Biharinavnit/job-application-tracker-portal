
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('jt_user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const demoLoginInFlight = useRef(false);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('jt_token', data.token);
      localStorage.setItem('jt_user', JSON.stringify(data.user));
      setUser(data.user);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.response?.data?.message || 'Login failed' };
    } finally { setLoading(false); }
  }, []);

  const loginDemo = useCallback(async () => {
    if (demoLoginInFlight.current) {
      return { success: false, message: 'Demo sign-in is already in progress.' };
    }
    demoLoginInFlight.current = true;
    setLoading(true);
    try {
      const { data } = await api.post('/auth/demo');
      localStorage.setItem('jt_token', data.token);
      localStorage.setItem('jt_user', JSON.stringify(data.user));
      setUser(data.user);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.response?.data?.message || 'Unable to start the demo session.' };
    } finally {
      demoLoginInFlight.current = false;
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (name, email, password) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', { name, email, password });
      localStorage.setItem('jt_token', data.token);
      localStorage.setItem('jt_user', JSON.stringify(data.user));
      setUser(data.user);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.response?.data?.message || 'Registration failed' };
    } finally { setLoading(false); }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('jt_token');
    localStorage.removeItem('jt_user');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, loginDemo, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
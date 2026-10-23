import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import api from '../utils/api';
import { AuthProvider, useAuth } from './AuthContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../utils/api', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

let auth;
let container;
let root;

function AuthProbe() {
  auth = useAuth();
  return <span>{auth.user?.email || 'signed out'}</span>;
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<AuthProvider><AuthProbe /></AuthProvider>);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
});

test('demo authentication stores its JWT and user through AuthContext', async () => {
  const demoUser = { id: 'demo-id', email: 'demo@example.test', name: 'JobTrack Demo', isDemo: true };
  api.post.mockResolvedValueOnce({ data: { token: 'demo-jwt', user: demoUser } });

  let result;
  await act(async () => {
    result = await auth.loginDemo();
  });

  expect(api.post).toHaveBeenCalledWith('/auth/demo');
  expect(result).toEqual({ success: true });
  expect(auth.user).toEqual(demoUser);
  expect(localStorage.getItem('jt_token')).toBe('demo-jwt');
  expect(JSON.parse(localStorage.getItem('jt_user'))).toEqual(demoUser);
});

test('failed demo authentication returns the API message and stores no session', async () => {
  api.post.mockRejectedValueOnce({ response: { data: { message: 'The demo account is not available.' } } });

  let result;
  await act(async () => {
    result = await auth.loginDemo();
  });

  expect(result).toEqual({ success: false, message: 'The demo account is not available.' });
  expect(auth.user).toBeNull();
  expect(auth.loading).toBe(false);
  expect(localStorage.getItem('jt_token')).toBeNull();
});

test('duplicate demo login calls are rejected while the request is pending', async () => {
  let resolveRequest;
  api.post.mockReturnValueOnce(new Promise((resolve) => {
    resolveRequest = resolve;
  }));

  let firstRequest;
  await act(async () => {
    firstRequest = auth.loginDemo();
    await Promise.resolve();
  });
  expect(auth.loading).toBe(true);

  let duplicate;
  await act(async () => {
    duplicate = await auth.loginDemo();
  });
  expect(duplicate.success).toBe(false);
  expect(api.post).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveRequest({ data: { token: 'demo-jwt', user: { id: 'demo-id', isDemo: true } } });
    await firstRequest;
  });
  expect(auth.loading).toBe(false);
});

test('normal login and logout keep existing token storage behavior', async () => {
  const user = { id: 'user-id', email: 'user@example.test', name: 'Regular User', isDemo: false };
  api.post.mockResolvedValueOnce({ data: { token: 'regular-jwt', user } });

  let result;
  await act(async () => {
    result = await auth.login('user@example.test', 'password');
  });

  expect(api.post).toHaveBeenCalledWith('/auth/login', { email: 'user@example.test', password: 'password' });
  expect(result).toEqual({ success: true });
  expect(localStorage.getItem('jt_token')).toBe('regular-jwt');
  expect(auth.user).toEqual(user);

  act(() => auth.logout());
  expect(localStorage.getItem('jt_token')).toBeNull();
  expect(localStorage.getItem('jt_user')).toBeNull();
  expect(auth.user).toBeNull();
});

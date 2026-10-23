import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import LoginPage from './LoginPage';

jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn() },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const renderLoginPage = (auth) => {
  useAuth.mockReturnValue(auth);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<p>Dashboard loaded</p>} />
        </Routes>
      </MemoryRouter>
    );
  });
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  if (root) act(() => root.unmount());
  if (container) container.remove();
});

test('Try Demo Account requests demo auth and navigates to Dashboard on success', async () => {
  const loginDemo = jest.fn().mockResolvedValue({ success: true });
  renderLoginPage({ login: jest.fn(), loginDemo, loading: false });

  const button = [...container.querySelectorAll('button')]
    .find((element) => element.textContent.includes('Try Demo Account'));
  expect(button).toBeDefined();
  expect(button.type).toBe('button');

  await act(async () => {
    button.click();
    await Promise.resolve();
  });

  expect(loginDemo).toHaveBeenCalledTimes(1);
  expect(loginDemo).toHaveBeenCalledWith();
  expect(container.textContent).toContain('Dashboard loaded');
});

test('demo login errors are displayed without navigating', async () => {
  const loginDemo = jest.fn().mockResolvedValue({
    success: false,
    message: 'The demo account is not available.',
  });
  renderLoginPage({ login: jest.fn(), loginDemo, loading: false });

  const button = [...container.querySelectorAll('button')]
    .find((element) => element.textContent.includes('Try Demo Account'));
  await act(async () => {
    button.click();
    await Promise.resolve();
  });

  expect(container.textContent).toContain('The demo account is not available.');
  expect(container.textContent).not.toContain('Dashboard loaded');
});

test('demo button is disabled while authentication is loading', () => {
  renderLoginPage({ login: jest.fn(), loginDemo: jest.fn(), loading: true });
  const button = [...container.querySelectorAll('button')]
    .find((element) => element.textContent.includes('Signing in'));

  expect(button.disabled).toBe(true);
});

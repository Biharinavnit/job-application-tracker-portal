import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Layout from './Layout';

jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root.unmount());
  if (container) container.remove();
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', originalMatchMedia);
  } else {
    delete window.matchMedia;
  }
  document.body.style.overflow = '';
  jest.clearAllMocks();
});

test('sidebar keeps the signed-in user name and Logout action', () => {
  const logout = jest.fn();
  useAuth.mockReturnValue({
    user: { name: 'Current User', email: 'user@example.test' },
    logout,
  });
  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<p>Dashboard</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  });

  expect(container.textContent).toContain('Current User');
  const logoutButton = container.querySelector('button[title="Logout"]');
  expect(logoutButton).not.toBeNull();

  act(() => logoutButton.click());
  expect(logout).toHaveBeenCalledTimes(1);
});

test('compact navigation opens, locks background scroll, and closes after navigation', () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches: query === '(max-width: 1024px)',
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
  useAuth.mockReturnValue({
    user: { name: 'Current User', email: 'user@example.test' },
    logout: jest.fn(),
  });

  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<p>Dashboard page</p>} />
            <Route path="/applications" element={<p>Applications page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  });

  const menuButton = container.querySelector('.mobile-menu-toggle');
  act(() => menuButton.click());
  expect(menuButton.getAttribute('aria-expanded')).toBe('true');
  expect(document.body.style.overflow).toBe('hidden');

  act(() => container.querySelector('.nav-item').nextElementSibling.click());
  expect(container.textContent).toContain('Applications page');
  expect(document.body.style.overflow).toBe('');
  expect(menuButton.getAttribute('aria-expanded')).toBe('false');
});

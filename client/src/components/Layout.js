
import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { path: '/dashboard',    icon: '◈', label: 'Dashboard' },
  { path: '/applications', icon: '☰', label: 'Applications' },
  { path: '/kanban',       icon: '⊞', label: 'Pipeline Board' },
  { path: '/reports',      icon: '◉', label: 'Reports' },
  { path: '/trash',        icon: '▤', label: 'Recently Deleted' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isCompact, setIsCompact] = useState(
    () => window.matchMedia?.('(max-width: 1024px)').matches || false
  );
  const menuButtonRef = useRef(null);
  const closeButtonRef = useRef(null);
  const sidebarRef = useRef(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(max-width: 1024px)');
    if (!mediaQuery) return undefined;
    const updateViewport = (event) => {
      setIsCompact(event.matches);
      if (!event.matches) setMenuOpen(false);
    };
    updateViewport(mediaQuery);
    mediaQuery.addEventListener?.('change', updateViewport);
    return () => mediaQuery.removeEventListener?.('change', updateViewport);
  }, []);

  useEffect(() => {
    if (isCompact && menuOpen) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      closeButtonRef.current?.focus();
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }
    if (isCompact) menuButtonRef.current?.focus();
    return undefined;
  }, [isCompact, menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen || !isCompact) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
      if (event.key === 'Tab') {
        const focusable = sidebarRef.current?.querySelectorAll(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isCompact, menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="app-shell">
      {isCompact && (
        <button
          className={`sidebar-backdrop ${menuOpen ? 'visible' : ''}`}
          type="button"
          aria-label="Close navigation menu"
          tabIndex="-1"
          hidden={!menuOpen}
          onClick={closeMenu}
        />
      )}
      <aside
        ref={sidebarRef}
        className={`sidebar ${menuOpen ? 'open' : ''}`}
        id="app-navigation"
        aria-label="Main navigation"
        aria-hidden={isCompact && !menuOpen}
        inert={isCompact && !menuOpen ? '' : undefined}
      >
        <div className="sidebar-logo">
          <div className="logo-mark">
            <div className="logo-icon">🎯</div>
            <div className="logo-text">Job<span>Track</span></div>
          </div>
          <button
            ref={closeButtonRef}
            className="sidebar-close"
            type="button"
            aria-label="Close navigation menu"
            onClick={closeMenu}
          >
            ×
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Application sections">
          <div className="nav-label">Menu</div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.path}
              type="button"
              className={`nav-item ${location.pathname === item.path || (item.path === '/trash' && location.pathname.startsWith('/trash/')) ? 'active' : ''}`}
              aria-current={location.pathname === item.path ? 'page' : undefined}
              onClick={() => {
                navigate(item.path);
                closeMenu();
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{user?.name?.charAt(0)?.toUpperCase() || 'U'}</div>
            <div className="user-info">
              <div className="user-name">{user?.name}</div>
              <div className="user-email">{user?.email}</div>
            </div>
            <button
              className="logout-btn"
              type="button"
              onClick={() => {
                logout();
                closeMenu();
              }}
              title="Logout"
              aria-label="Logout"
            >
              ⏻
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="main-content" inert={isCompact && menuOpen ? '' : undefined}>
        <header className="mobile-topbar">
          <button
            ref={menuButtonRef}
            className="mobile-menu-toggle"
            type="button"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-controls="app-navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <div className="mobile-topbar-brand">
            <span className="logo-icon" aria-hidden="true">🎯</span>
            <span className="logo-text">Job<span>Track</span></span>
          </div>
          <span className="mobile-topbar-user">{user?.name}</span>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
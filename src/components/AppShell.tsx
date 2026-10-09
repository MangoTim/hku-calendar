// AppShell — wraps the sidebar + topbar + main content for any authenticated page.
// Also owns the mobile drawer state (sidebar slides in from the left on small screens).
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Auto-close the drawer whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Lock body scroll while drawer is open on mobile.
  useEffect(() => {
    if (menuOpen) {
      document.body.classList.add('menu-open');
      return () => document.body.classList.remove('menu-open');
    }
  }, [menuOpen]);

  // If the window is resized to desktop, close the drawer so the sidebar is visible.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 960) setMenuOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className={`app ${menuOpen ? 'app--menu-open' : ''}`}>
      {/* Skip link — visible on keyboard focus, lets screen-reader / keyboard-only
          users jump past the sidebar straight to the page heading. */}
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <Topbar title={title} menuOpen={menuOpen} onToggleMenu={() => setMenuOpen(o => !o)} />
      <main id="main-content" className="app__main" aria-label="Main content" tabIndex={-1}>
        {children}
      </main>
      <div
        className="app__backdrop"
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
    </div>
  );
}

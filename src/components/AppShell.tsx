// AppShell — wraps the sidebar + topbar + main content for any authenticated page.
import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="app">
      {/* Skip link — visible on keyboard focus, lets screen-reader / keyboard-only
          users jump past the sidebar straight to the page heading. */}
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <Sidebar />
      <Topbar title={title} />
      <main id="main-content" className="app__main" aria-label="Main content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

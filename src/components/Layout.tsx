import { Link, NavLink, useLocation } from "react-router-dom";
import { BookOpen, BarChart3, Newspaper, Sun, Moon, Home } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

const tabs = [
  { to: "/", label: "Home", icon: Home },
  { to: "/skills", label: "Skills", icon: BookOpen },
  { to: "/stats", label: "Stats", icon: BarChart3 },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const isDigest = /^\/d\//.test(location.pathname) || /^\/feed\//.test(location.pathname);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 border-b border-paper-200 dark:border-paper-800 bg-paper-50/90 dark:bg-paper-950/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <span className="w-8 h-8 rounded-lg bg-moss-600 dark:bg-moss-500 flex items-center justify-center text-white">
              <Newspaper size={16} />
            </span>
            <span className="headline-serif text-lg">Morning Brief</span>
          </Link>
          <div className="flex items-center gap-1">
            {!isDigest &&
              tabs.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-paper-200/70 dark:bg-paper-800 text-ink-900 dark:text-paper-50"
                        : "text-ink-500 dark:text-paper-300 hover:bg-paper-100 dark:hover:bg-paper-800"
                    }`
                  }
                >
                  <span className="hidden sm:inline">{t.label}</span>
                  <t.icon size={16} className="sm:hidden" />
                </NavLink>
              ))}
            <button
              onClick={toggle}
              aria-label="Toggle dark mode"
              className="ml-1 p-2 rounded-lg text-ink-500 dark:text-paper-300 hover:bg-paper-100 dark:hover:bg-paper-800 transition-colors"
            >
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
      </main>
      <footer className="border-t border-paper-200 dark:border-paper-800 py-6 text-center text-xs text-ink-400 dark:text-paper-400">
        Read-only, polite fetching · 200 calls/day demo cap · built with Jev + a morning ritual
      </footer>
    </div>
  );
}

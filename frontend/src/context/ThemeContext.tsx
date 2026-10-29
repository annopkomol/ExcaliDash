import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { usePreference } from "./PreferencesContext";

type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const systemPrefersDark = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(DARK_QUERY).matches;

interface ThemeContextType {
  /** Resolved theme actually applied (never "system"). */
  theme: Theme;
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Server-backed via the shared preferences context (no-clobber-on-first-mount
  // and refetch-on-user-change live there); this wrapper only owns the DOM side
  // effects for the resolved theme.
  const [themePreference, setThemePreference] = usePreference(
    "theme",
    "system",
  );
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Follow the OS setting live while the preference is "system".
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const theme: Theme =
    themePreference === "system"
      ? systemDark
        ? "dark"
        : "light"
      : themePreference;

  useEffect(() => {
    const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (link) {
      link.href = theme === "dark" ? "/favicon-dark.svg" : "/favicon-light.svg";
    }

    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  const toggleTheme = () => {
    setThemePreference(theme === "light" ? "dark" : "light");
  };

  return (
    <ThemeContext.Provider value={{ theme, themePreference, setThemePreference, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};

import * as React from "react";

/**
 * Mirrors the CSS dual-selector rule in styles/theme.css (design doc
 * §8): the *effective* theme is the host's explicit override
 * (`[data-theme]` on `documentElement`, set by `applyDocumentTheme()`)
 * when present, else the OS-level `prefers-color-scheme`. Needed because
 * `<Toaster theme="light" | "dark" | "system">` (sonner) has no way to
 * see our CSS custom properties — its `"system"` option only reads
 * `prefers-color-scheme`, which misses a host-driven theme switch
 * exactly the way a CSS rule with only a media query (no `[data-theme]`
 * selector) would. Found via axe-core's a11y audit surfacing sonner's
 * own light-mode richColors palette as low-contrast, which led to
 * checking it in an actually-dark host — the toaster was rendering
 * light-themed toasts over a dark widget the whole time, unrelated to
 * the contrast bug itself but caught by the same investigation.
 */
export function useEffectiveTheme(): "light" | "dark" {
  const getTheme = React.useCallback((): "light" | "dark" => {
    const explicit = document.documentElement.dataset.theme;
    if (explicit === "light" || explicit === "dark") return explicit;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, []);

  const [theme, setTheme] = React.useState<"light" | "dark">(getTheme);

  React.useEffect(() => {
    const update = () => setTheme(getTheme());
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mql.removeEventListener("change", update);
      observer.disconnect();
    };
  }, [getTheme]);

  return theme;
}

/**
 * Theme preference — light / dark / system.
 *
 * ເກັບໄວ້ໃນ localStorage ບໍ່ແມ່ນ cookie ເພາະມັນເປັນຄ່າຂອງ **ເຄື່ອງ** ບໍ່ແມ່ນຂອງບັນຊີ:
 * ຄົນດຽວກັນອາດໃຊ້ມືຖືໃນສາງ (ມືດ) ແລະ ຄອມໃນຫ້ອງການ (ແຈ້ງ).
 *
 * The stored value can be "system"; what lands on <html data-theme> is always
 * resolved to a literal "light" or "dark" so CSS never has to ask twice.
 */
export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "wms.theme";

/**
 * Runs before first paint (inline, in the root layout <head>) so the page never
 * flashes the wrong theme. Kept dependency-free and wrapped in try/catch —
 * private-mode browsers throw on localStorage access.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)})||"system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.setAttribute("data-theme",d?"dark":"light");e.setAttribute("data-theme-pref",p);}catch(_){document.documentElement.setAttribute("data-theme","light");}})();`;

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === "system") {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return pref;
}

/** Stamp the resolved theme on <html> and remember the raw preference. */
export function applyTheme(pref: ThemePref) {
  const el = document.documentElement;
  el.setAttribute("data-theme", resolveTheme(pref));
  el.setAttribute("data-theme-pref", pref);
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* private mode — the choice just will not survive a reload */
  }
}

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

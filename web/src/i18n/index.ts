import en from "./en.js";
import de from "./de.js";

const translations: Record<string, Record<string, string>> = { en, de };

export type SupportedLang = "en" | "de";

export type LegalPageSlug = "terms" | "privacy" | "impressum";

export function resolveLang(lang?: string | null): SupportedLang {
  return lang === "de" ? "de" : "en";
}

export function getLang(): SupportedLang {
  return resolveLang(document.documentElement.lang);
}

export function translate(
  lang: string | null | undefined,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const resolvedLang = resolveLang(lang);
  const str = translations[resolvedLang]?.[key] ?? translations.en[key] ?? key;
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function t(key: string, vars?: Record<string, string | number>): string {
  return translate(getLang(), key, vars);
}

export function getLegalPageHref(page: LegalPageSlug, lang?: string | null): string {
  const resolvedLang = resolveLang(lang);
  return resolvedLang === "de" ? `/de/${page}` : `/${page}`;
}

export function applyTranslations(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n")!;
    const varsAttr = el.getAttribute("data-i18n-vars");
    const vars = varsAttr ? JSON.parse(varsAttr) : undefined;

    // Handle date interpolation: if this element also has data-i18n-date,
    // format the date in the current locale and inject it as the {date} var
    const isoDate = el.getAttribute("data-i18n-date");
    if (isoDate && vars && vars.date === "__date__") {
      vars.date = new Date(isoDate).toLocaleDateString(getLang(), {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }

    el.textContent = t(key, vars);
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder")!;
    (el as HTMLInputElement).placeholder = t(key);
  });
}

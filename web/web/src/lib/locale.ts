export function applyDocumentLocale(lang: string) {
  const normalized = lang?.startsWith("ar") ? "ar" : "en";
  const isArabic = normalized === "ar";
  document.documentElement.lang = normalized;
  document.documentElement.dir = isArabic ? "rtl" : "ltr";
}

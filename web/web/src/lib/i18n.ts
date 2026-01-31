import type { TFunction } from "i18next";

/**
 * Use this when you're migrating gradually:
 * - If key exists: returns translation
 * - If missing: returns fallback (English string you provide)
 */
export function tSafe(t: TFunction, key: string, fallback: string) {
  const out = t(key);
  return out === key ? fallback : out;
}

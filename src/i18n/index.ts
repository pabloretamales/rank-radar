/**
 * i18n helper for RankRadar.
 * Defaults to ES; mirrors `/en/...` routes for EN.
 */

export type Locale = 'es' | 'en';

export const defaultLocale: Locale = 'es';
export const locales: Locale[] = ['es', 'en'];

export function detectLocaleFromUrl(url: URL): Locale {
  const pathname = url.pathname;
  return pathname.startsWith('/en/') || pathname === '/en' ? 'en' : 'es';
}

export function oppositeLocale(locale: Locale): Locale {
  return locale === 'es' ? 'en' : 'es';
}

export function localizedPath(locale: Locale, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return locale === defaultLocale ? clean : `/en${clean}`;
}

import esDict from './es.json';
import enDict from './en.json';

export type Dictionary = typeof esDict;

export function getDict(locale: Locale): Dictionary {
  return locale === 'en' ? (enDict as Dictionary) : esDict;
}

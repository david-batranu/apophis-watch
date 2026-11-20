/**
 * Tiny i18n access layer.
 *
 * English is the only catalogue in this build. `t()` takes a typed dotted key
 * and fills `{name}` placeholders from `params`; it never escapes the result,
 * because callers choose textContent or innerHTML as before.
 */
import { en } from './en';

export { en };
export const strings = en;

/** Formatting locale for numbers/dates. UI copy remains English for now. */
export const DEFAULT_FORMAT_LOCALE = 'ro-RO';

export type I18nParams = Record<string, string | number>;

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type I18nKey = Leaves<typeof en>;

function lookup(key: string): string {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') {
      throw new Error(`Missing i18n key: ${key}`);
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') {
    throw new Error(`Missing i18n key: ${key}`);
  }
  return node;
}

function interpolate(template: string, params?: I18nParams): string {
  if (!params) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function t(key: I18nKey, params?: I18nParams): string {
  return interpolate(lookup(key), params);
}

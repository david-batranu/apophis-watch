/**
 * Field-check records for best-spot candidates.
 *
 * These are the user's own observations, not computed visibility. They are
 * deliberately stored locally and never uploaded.
 */

export type FieldCheckStatus = 'pass' | 'fail' | 'unknown';

export interface FieldCheckRecord {
  status: FieldCheckStatus;
  note: string;
  updatedAt: number;
}

export type FieldCheckStore = Record<string, FieldCheckRecord>;

const STORAGE_KEY = 'apophis-field-checks-v1';

export function fieldCheckKey(latitudeDeg: number, longitudeDeg: number): string {
  return `${latitudeDeg.toFixed(5)},${longitudeDeg.toFixed(5)}`;
}

export function loadFieldChecks(): FieldCheckStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as FieldCheckStore;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: FieldCheckStore = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (
        value &&
        (value.status === 'pass' ||
          value.status === 'fail' ||
          value.status === 'unknown') &&
        typeof value.note === 'string'
      ) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveFieldChecks(store: FieldCheckStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Field checks are optional local notes.
  }
}

export function setFieldCheck(
  store: FieldCheckStore,
  latitudeDeg: number,
  longitudeDeg: number,
  status: FieldCheckStatus,
  note?: string,
): FieldCheckStore {
  const key = fieldCheckKey(latitudeDeg, longitudeDeg);
  const next: FieldCheckStore = {
    ...store,
    [key]: {
      status,
      note: note ?? store[key]?.note ?? '',
      updatedAt: Date.now(),
    },
  };
  saveFieldChecks(next);
  return next;
}

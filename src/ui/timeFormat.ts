/** Formatting helpers for UTC and the browser's IANA local time zone. */

const PART_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
};

function parts(ms: number, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    ...PART_OPTIONS,
    timeZone,
  });
  const result: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') result[part.type] = part.value;
  }
  return result;
}

export function formatUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

export interface LocalTimeParts {
  date: string;
  time: string;
  label: string;
  zone: string;
  offset: string;
}

/** Browser local time; DST is handled by the IANA zone, not by a fixed offset. */
export function formatLocal(ms: number, timeZone: string): LocalTimeParts {
  const p = parts(ms, timeZone);
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}:${p.second}`;
  const zoneFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    timeZoneName: 'short',
  });
  const zone =
    zoneFormatter.formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName')
      ?.value ?? timeZone;
  const offsetFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    timeZoneName: 'longOffset',
  });
  const offset =
    offsetFormatter.formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName')
      ?.value ?? '';
  return { date, time, label: `${date} ${time}`, zone, offset };
}

/** HH:mm local label used on sky-trail ticks. */
export function localHhMm(ms: number, timeZone: string): string {
  const p = parts(ms, timeZone);
  return `${p.hour}:${p.minute}`;
}

export function localDateHhMm(ms: number, timeZone: string): string {
  const p = parts(ms, timeZone);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

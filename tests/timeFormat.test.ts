import { describe, expect, it } from 'vitest';
import { formatLocal, formatUtc, localHhMm } from '../src/ui/timeFormat';

describe('UTC and local time formatting', () => {
  const ca = Date.parse('2029-04-13T21:45:03Z');

  it('formats the Phase 1 closest-approach UTC instant', () => {
    expect(formatUtc(ca)).toBe('2029-04-13 21:45:03 UTC');
  });

  it('handles Europe/Bucharest DST: 21:45:03 UTC is 00:45:03 EEST', () => {
    const local = formatLocal(ca, 'Europe/Bucharest');
    expect(local.date).toBe('2029-04-14');
    expect(local.time).toBe('00:45:03');
    expect(local.offset).toBe('GMT+03:00');
    expect(localHhMm(ca, 'Europe/Bucharest')).toBe('00:45');
  });

  it('handles Europe/Bucharest winter time (EET, +02:00)', () => {
    const winter = Date.parse('2029-01-15T12:00:00Z');
    const local = formatLocal(winter, 'Europe/Bucharest');
    expect(local.date).toBe('2029-01-15');
    expect(local.time).toBe('14:00:00');
    expect(local.offset).toBe('GMT+02:00');
  });

  it('does not silently use the browser zone for an explicit zone', () => {
    const ny = formatLocal(ca, 'America/New_York');
    expect(ny.date).toBe('2029-04-13');
    expect(ny.time).toBe('17:45:03');
  });
});

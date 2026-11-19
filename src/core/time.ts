import { AstroTime } from 'astronomy-engine';

/** Milliseconds per day. */
export const MS_PER_DAY = 86_400_000;
/** Seconds per day. */
export const SEC_PER_DAY = 86_400;
/** Julian Date of the Unix epoch, 1970-01-01T00:00:00Z. */
export const JD_UNIX_EPOCH = 2_440_587.5;
/** Julian Date of the J2000.0 epoch (2000-01-01T12:00:00 TT). */
export const JD_J2000 = 2_451_545.0;

/**
 * UTC dates at which TAI-UTC increased by one second, paired with the new
 * TAI-UTC value. IERS Bulletin C; last change 2017-01-01.
 */
const LEAP_SECONDS: ReadonlyArray<readonly [string, number]> = [
  ['1972-01-01T00:00:00Z', 10],
  ['1972-07-01T00:00:00Z', 11],
  ['1973-01-01T00:00:00Z', 12],
  ['1974-01-01T00:00:00Z', 13],
  ['1975-01-01T00:00:00Z', 14],
  ['1976-01-01T00:00:00Z', 15],
  ['1977-01-01T00:00:00Z', 16],
  ['1978-01-01T00:00:00Z', 17],
  ['1979-01-01T00:00:00Z', 18],
  ['1980-01-01T00:00:00Z', 19],
  ['1981-07-01T00:00:00Z', 20],
  ['1982-07-01T00:00:00Z', 21],
  ['1983-07-01T00:00:00Z', 22],
  ['1985-07-01T00:00:00Z', 23],
  ['1988-01-01T00:00:00Z', 24],
  ['1990-01-01T00:00:00Z', 25],
  ['1991-01-01T00:00:00Z', 26],
  ['1992-07-01T00:00:00Z', 27],
  ['1993-07-01T00:00:00Z', 28],
  ['1994-07-01T00:00:00Z', 29],
  ['1996-01-01T00:00:00Z', 30],
  ['1997-07-01T00:00:00Z', 31],
  ['1999-01-01T00:00:00Z', 32],
  ['2006-01-01T00:00:00Z', 33],
  ['2009-01-01T00:00:00Z', 34],
  ['2012-07-01T00:00:00Z', 35],
  ['2015-07-01T00:00:00Z', 36],
  ['2017-01-01T00:00:00Z', 37],
];

const LEAP_SECONDS_MS = LEAP_SECONDS.map(([iso, taiMinusUtc]) => ({
  ms: Date.parse(iso),
  taiMinusUtc,
}));

/** TAI - UTC in seconds for a UTC instant, from the leap-second table. */
export const taiMinusUtcSeconds = (date: Date): number => {
  const ms = date.getTime();
  let value = 10;
  for (const entry of LEAP_SECONDS_MS) {
    if (ms < entry.ms) break;
    value = entry.taiMinusUtc;
  }
  return value;
};

/** TT - UTC in seconds for a UTC instant (32.184 s + leap seconds). */
export const ttMinusUtcSeconds = (date: Date): number =>
  32.184 + taiMinusUtcSeconds(date);

/**
 * TT - UTC for the committed 2029 window, in seconds.
 *
 * 37 leap seconds (last added 2017-01-01, none announced through 2026) plus
 * the fixed 32.184 s offset between TT and TAI. Regenerate the committed data
 * if a leap second is announced before 2029.
 */
export const TT_MINUS_UTC_SECONDS = 32.184 + 37;
/** Leap seconds in force for the 2029 window. */
export const LEAP_SECONDS_2029 = 37;

/** Convert a UTC Unix-millisecond value to a Julian Date (UTC). */
export const msToJd = (ms: number): number => ms / MS_PER_DAY + JD_UNIX_EPOCH;

/** Convert a Julian Date (UTC) to Unix milliseconds. */
export const jdToMs = (jd: number): number => (jd - JD_UNIX_EPOCH) * MS_PER_DAY;

export const dateToJdUtc = (date: Date): number => msToJd(date.getTime());

export const jdUtcToDate = (jd: number): Date => new Date(jdToMs(jd));

/**
 * TDB - TT in seconds, using the leading terms of the Fairhead & Bretagnon
 * series (Meeus, Astronomical Algorithms, 2nd ed., eq. 10.1). Residual is
 * well below 1 ms across 2029, i.e. < 10 m of Apophis motion.
 */
export const tdbMinusTtSeconds = (jdTt: number): number => {
  const g = (357.53 + 0.9856003 * (jdTt - JD_J2000)) * (Math.PI / 180);
  return 0.001657 * Math.sin(g) + 0.000022 * Math.sin(2 * g);
};

/**
 * TT Julian Date for a UTC Date.
 *
 * We deliberately do NOT use astronomy-engine's `AstroTime.tt` here: that is
 * TT - UT1 based on its own Delta-T prediction (about 77 s in 2029), while
 * the physical time scale we need is TT - UTC (69.184 s in 2029). Mixing the
 * two would shift Apophis by ~60 km near closest approach.
 */
export const jdTtFromDate = (date: Date): number =>
  dateToJdUtc(date) + ttMinusUtcSeconds(date) / SEC_PER_DAY;

/**
 * TDB Julian Date for a UTC Date.
 * UTC -> TT via astronomy-engine (leap seconds), TT -> TDB via the series above.
 */
export const jdTdbFromDate = (date: Date): number => {
  const jdTt = jdTtFromDate(date);
  return jdTt + tdbMinusTtSeconds(jdTt) / SEC_PER_DAY;
};

/** TT Julian Date corresponding to a TDB Julian Date. */
export const jdTtFromJdTdb = (jdTdb: number): number => {
  // The TDB-TT correction varies by < 1 ms over a day; two fixed-point
  // iterations make the inversion exact to far below that.
  let jdTt = jdTdb;
  for (let i = 0; i < 2; i++) {
    jdTt = jdTdb - tdbMinusTtSeconds(jdTt) / SEC_PER_DAY;
  }
  return jdTt;
};

/**
 * UTC Julian Date corresponding to a TDB Julian Date.
 * Valid for the 2029 data window, where TT-UTC is constant.
 */
export const jdUtcFromJdTdb = (jdTdb: number): number =>
  jdTtFromJdTdb(jdTdb) - TT_MINUS_UTC_SECONDS / SEC_PER_DAY;

/** UTC Date corresponding to a TDB Julian Date. */
export const dateFromJdTdb = (jdTdb: number): Date =>
  jdUtcToDate(jdUtcFromJdTdb(jdTdb));

/**
 * astronomy-engine time object for a TDB Julian Date.
 *
 * Constructed from the UTC Date so that `.ut` (which drives sidereal time)
 * is the real UTC/UT1-like value. astronomy-engine's `.tt` will be off by its
 * Delta-T prediction error (~8 s in 2029), which is harmless for Sun/Moon
 * positions and aberration but would be fatal if used for Earth rotation.
 */
export const astroTimeFromJdTdb = (jdTdb: number): AstroTime =>
  new AstroTime(dateFromJdTdb(jdTdb));

/** ISO 8601 UTC label for a TDB Julian Date. */
export const isoFromJdTdb = (jdTdb: number): string =>
  dateFromJdTdb(jdTdb).toISOString();

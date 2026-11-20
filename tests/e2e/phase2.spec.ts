import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE =
  '/?lat=45.6427&lon=25.5887&elev=600&eye=0&debug=1&utc=';
const SHOTS = resolve(process.cwd(), 'test-results/phase2');

// Frozen Phase 1 targets at Brasov 600 m, eye 0. These are the published
// values from PHASE1-VALIDATION.md, not recomputed from the app under test.
const EXPECTED = {
  topocentricCa: '2029-04-13 21:35:42 UTC',
  geocentricCa: '2029-04-13 21:45:03 UTC',
  rise: '2029-04-13 17:15:43 UTC',
  set: '2029-04-13 22:44:06 UTC',
  maxElevation: '2029-04-13 20:45:04 UTC',
  visibilityStart: '2029-04-13 17:32:35 UTC',
  visibilityEnd: '2029-04-13 22:44:06 UTC',
};

async function gotoAt(page: import('@playwright/test').Page, utc: string): Promise<void> {
  await page.goto(`${BASE}${encodeURIComponent(utc)}`);
  await expect(page.locator('[data-ref="utc-clock"]')).toContainText('UTC');
  await expect(page.locator('[data-ref="debug-overlay"]')).toBeVisible();
  await page.waitForTimeout(700);
}

async function debugState(page: import('@playwright/test').Page) {
  return page.locator('[data-ref="debug-overlay"]').evaluate((el) => ({
    text: el.textContent ?? '',
    markerX: el.dataset.markerX,
    markerY: el.dataset.markerY,
    trailTimes: el.dataset.trailLabelTimes,
    az: el.dataset.az,
    el: el.dataset.el,
    centerAz: el.dataset.centerAz,
    centerEl: el.dataset.centerEl,
    zoom: el.dataset.zoom,
    horizon: el.dataset.horizon,
    canvasW: el.dataset.canvasW,
    canvasH: el.dataset.canvasH,
  }));
}

/** Independent copy of the stereographic projection, for marker pixel checks. */
function projectMarker(
  azDeg: number,
  elDeg: number,
  centerAzDeg: number,
  centerElDeg: number,
  horizonRadiusPx: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const D = Math.PI / 180;
  const toVec = (az: number, el: number) => {
    const a = az * D;
    const e = el * D;
    return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
  };
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const norm = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a: number[]) => a.map((v) => v / norm(a));
  const center = toVec(centerAzDeg, centerElDeg);
  let right: number[];
  let up: number[];
  if (1 - center[2] < 1e-9) {
    right = [1, 0, 0];
    up = [0, 1, 0];
  } else {
    right = unit(cross(center, [0, 0, 1]));
    up = unit(cross(right, center));
  }
  const p = toVec(azDeg, elDeg);
  const scale = horizonRadiusPx / 2;
  const k = (2 * scale) / (1 + dot(p, center));
  return {
    x: width / 2 + k * dot(p, right),
    y: height / 2 - k * dot(p, up),
  };
}

test('sky screenshots at three Brasov times, with marker/screen consistency', async ({
  page,
}, testInfo) => {
  mkdirSync(SHOTS, { recursive: true });
  const cases = [
    {
      id: '2045',
      utc: '2029-04-13T20:45:00Z',
      note: '20:45 UTC, shortly before the topocentric close approach',
    },
    {
      id: 'topoca',
      utc: '2029-04-13T21:35:42Z',
      note: 'topocentric closest approach (Brasov, 600 m + eye 0)',
    },
    {
      id: 'near-setting',
      utc: '2029-04-13T22:40:00Z',
      note: 'near setting (set is ~22:44 UTC)',
    },
  ];
  for (const c of cases) {
    await gotoAt(page, c.utc);
    const d = await debugState(page);
    const az = Number(d.az);
    const el = Number(d.el);
    const markerX = Number(d.markerX);
    const markerY = Number(d.markerY);
    expect(Number.isFinite(az)).toBe(true);
    expect(Number.isFinite(el)).toBe(true);
    expect(Number.isFinite(markerX)).toBe(true);
    expect(Number.isFinite(markerY)).toBe(true);

    const expectedPx = projectMarker(
      az,
      el,
      Number(d.centerAz),
      Number(d.centerEl),
      Number(d.horizon),
      Number(d.canvasW),
      Number(d.canvasH),
    );
    expect(Math.abs(markerX - expectedPx.x)).toBeLessThan(1);
    expect(Math.abs(markerY - expectedPx.y)).toBeLessThan(1);
    expect(markerX).toBeGreaterThanOrEqual(0);
    expect(markerX).toBeLessThanOrEqual(Number(d.canvasW));
    expect(markerY).toBeGreaterThanOrEqual(0);
    expect(markerY).toBeLessThanOrEqual(Number(d.canvasH));

    // Prove something is actually painted at the debug marker position.
    const markerPixel = await page.evaluate(
      ({ x, y }) => {
        const canvas = document.querySelector<HTMLCanvasElement>('.sky-canvas')!;
        const ratio = canvas.width / canvas.clientWidth;
        const data = canvas
          .getContext('2d')!
          .getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data;
        return [data[0], data[1], data[2], data[3]];
      },
      { x: markerX, y: markerY },
    );
    expect(markerPixel[0]).toBeGreaterThan(35);
    expect(markerPixel[0]).toBeGreaterThan(markerPixel[2] + 10);

    const times = (d.trailTimes ?? '').split(',').filter(Boolean);
    expect(times.length).toBeGreaterThan(0);
    for (let i = 1; i < times.length; i++) {
      expect(Date.parse(times[i])).toBeGreaterThan(Date.parse(times[i - 1]));
    }

    const stripText = await page.locator('[data-ref="trail-strip"]').innerText();
    const stripTimes = stripText.match(/\b\d{2}:\d{2}\b/g) ?? [];
    expect(stripTimes.length).toBeGreaterThan(3);
    const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    expect((minutes(stripTimes[1]!) - minutes(stripTimes[0]!) + 1440) % 1440).toBe(5);
    expect((minutes(stripTimes[2]!) - minutes(stripTimes[1]!) + 1440) % 1440).toBe(5);

    const debugPath = resolve(SHOTS, `sky-${c.id}-debug.png`);
    await page.locator('.sky-stage').screenshot({ path: debugPath });
    await testInfo.attach(`sky-${c.id}-debug`, { path: debugPath, contentType: 'image/png' });
    // Clean image for visual review: the fixed debug panel otherwise covers
    // the southern horizon and part of the readout.
    await page.locator('[data-ref="debug-overlay"]').evaluate((el) => {
      (el as HTMLElement).style.display = 'none';
    });
    const path = resolve(SHOTS, `sky-${c.id}.png`);
    await page.locator('.sky-stage').screenshot({ path });
    await testInfo.attach(`sky-${c.id}`, { path, contentType: 'image/png' });
    console.log(
      `${c.note}: az ${az.toFixed(3)}°, el ${el.toFixed(3)}°, marker ${markerX.toFixed(2)},${markerY.toFixed(2)} px, ${times.length} local-time labels`,
    );
  }
});

test('jump-to buttons land on the Phase 1 values and DST local clock', async ({
  page,
}) => {
  await gotoAt(page, '2029-04-13T20:45:00Z');
  const clock = page.locator('[data-ref="utc-clock"]');
  const local = page.locator('[data-ref="local-clock"]');

  await page.locator('[data-jump="geocentricCa"]').click();
  await expect(clock).toHaveText(EXPECTED.geocentricCa);
  await expect(local).toContainText('2029-04-14 00:45:03');
  await expect(local).toContainText('EEST');

  await page.locator('[data-jump="topocentricCa"]').click();
  await expect(clock).toHaveText(EXPECTED.topocentricCa);
  await expect(local).toContainText('2029-04-14 00:35:42');

  for (const [target, value] of [
    ['rise', EXPECTED.rise],
    ['set', EXPECTED.set],
    ['maxElevation', EXPECTED.maxElevation],
    ['visibilityStart', EXPECTED.visibilityStart],
    ['visibilityEnd', EXPECTED.visibilityEnd],
  ] as const) {
    await page.locator(`[data-jump="${target}"]`).click();
    await expect(clock).toHaveText(value);
  }
});

test('size comparison is calculated at the current range', async ({ page }) => {
  await gotoAt(page, '2029-04-13T21:45:03.557Z');
  const panel = page.locator('[data-ref="size-panel"]');
  await expect(panel).toContainText('2.015″');
  await expect(panel).toContainText('1.956″');
  await expect(panel).toContainText('5.7'); // Moon at Apophis distance, degrees
  await expect(panel).toContainText('34,803.7 km');
});

test('night mode red-on-black covers panels, controls and canvas', async ({ page }) => {
  await gotoAt(page, '2029-04-13T20:45:00Z');
  await page.locator('[data-ref="night-button"]').click();
  await expect(page.locator('body')).toHaveClass(/night/);
  // Let the 120 ms background transition finish before sampling computed styles.
  await page.waitForTimeout(300);
  const colors = await page.evaluate(() => {
    const pick = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor };
    };
    return {
      body: pick('body'),
      panel: pick('.panel'),
      button: pick('.btn'),
      metric: pick('.metric'),
      clock: pick('.clock-utc'),
      input: pick('input[type="range"]'),
      debug: pick('.debug-overlay'),
      sky: pick('.sky-stage'),
    };
  });
  const bg = (value: string | undefined) =>
    (value ?? '').match(/\d+/g)?.map(Number).slice(0, 3) ?? [];
  console.log('night colours', colors);
  for (const key of ['body', 'panel', 'button', 'metric', 'debug', 'sky'] as const) {
    const rgb = bg(colors[key]?.background);
    if (rgb.length === 3) {
      expect(rgb[0], `${key} red`).toBeLessThan(40);
      expect(rgb[1], `${key} green`).toBeLessThan(40);
      expect(rgb[2], `${key} blue`).toBeLessThan(40);
    }
  }
  const clockRgb = bg(colors.clock?.color);
  expect(clockRgb[0]).toBeGreaterThan(150);
  expect(clockRgb[0]).toBeGreaterThan(clockRgb[1]);
  expect(clockRgb[0]).toBeGreaterThan(clockRgb[2]);
  const pixel = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.sky-canvas')!;
    const ctx = canvas.getContext('2d')!;
    const d = ctx.getImageData(2, 2, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  });
  expect(pixel[0]).toBeLessThan(20);
  expect(pixel[1]).toBeLessThan(20);
  expect(pixel[2]).toBeLessThan(20);
  const plotPixel = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.plot-canvas')!;
    const ctx = canvas.getContext('2d')!;
    const d = ctx.getImageData(2, 2, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  });
  expect(plotPixel[0]).toBeLessThan(20);
  expect(plotPixel[1]).toBeLessThan(20);
  expect(plotPixel[2]).toBeLessThan(20);
  mkdirSync(SHOTS, { recursive: true });
  await page.locator('[data-ref="debug-overlay"]').evaluate((el) => {
    (el as HTMLElement).style.display = 'none';
  });
  await page.locator('.sky-stage').screenshot({ path: resolve(SHOTS, 'sky-night.png') });
  await page.screenshot({ path: resolve(SHOTS, 'night-full.png'), fullPage: true });
  await page.getByRole('button', { name: 'Space view' }).click();
  await page.waitForTimeout(500);
  const spaceShot = await page.locator('.space-stage').screenshot({
    path: resolve(SHOTS, 'space-night.png'),
  });
  const bluePixels = await page.evaluate(async (b64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 2] > data[i] + 20 && data[i + 2] > 60) count++;
    }
    return count;
  }, spaceShot.toString('base64'));
  expect(bluePixels).toBeLessThan(100);
});

test('space view renders and camera presets respond', async ({ page }) => {
  await gotoAt(page, '2029-04-13T21:45:03.557Z');
  await page.getByRole('button', { name: 'Space view' }).click();
  await expect(page.locator('.space-stage')).toBeVisible();
  for (const name of ['Earth', 'Moon orbit', 'Top-down', 'Flyby']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await page.waitForTimeout(500);
  await page.locator('[data-ref="debug-overlay"]').evaluate((el) => {
    (el as HTMLElement).style.display = 'none';
  });
  await page.locator('.space-stage').screenshot({ path: resolve(SHOTS, 'space-day.png') });
  await page.getByRole('button', { name: 'Moon orbit', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.space-stage').screenshot({ path: resolve(SHOTS, 'space-moon-orbit.png') });
});

test('drag and wheel change the sky projection and reset restores it', async ({
  page,
}) => {
  await gotoAt(page, '2029-04-13T20:45:00Z');
  const before = await debugState(page);
  const box = await page.locator('.sky-canvas').boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 55, cy + 35, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterPan = await debugState(page);
  expect(
    Number(afterPan.centerAz) !== Number(before.centerAz) ||
      Number(afterPan.centerEl) !== Number(before.centerEl),
  ).toBe(true);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(150);
  const afterZoom = await debugState(page);
  expect(Number(afterZoom.zoom)).toBeGreaterThan(Number(afterPan.zoom));
  await page.locator('.sky-canvas').dblclick({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(150);
  const reset = await debugState(page);
  expect(Number(reset.centerAz)).toBeCloseTo(0, 5);
  expect(Number(reset.centerEl)).toBeCloseTo(90, 5);
  expect(Number(reset.zoom)).toBeCloseTo(1, 5);
});

test('clamps out-of-range time and never extrapolates', async ({ page }) => {
  await page.goto(`${BASE}${encodeURIComponent('2030-01-01T00:00:00Z')}`);
  await expect(page.locator('[data-ref="utc-clock"]')).toHaveText(
    '2029-04-14 21:45:03 UTC',
  );
  await expect(page.locator('[data-ref="error-line"]')).toContainText(
    'outside the committed ±24 h data window',
  );
});

test('preset and manual observer inputs update the session', async ({ page }) => {
  await gotoAt(page, '2029-04-13T20:45:00Z');
  await page.locator('[data-ref="preset-select"]').selectOption('cape-town');
  await expect(page.locator('[data-ref="location-status"]')).toContainText(
    'Cape Town',
  );
  await expect(page.locator('[data-ref="location-chip"]')).toContainText('-33.92');
  await page.locator('#lat').fill('10');
  await page.locator('#lon').fill('20');
  await page.locator('#elev').fill('100');
  await page.locator('#eye').fill('2');
  await page.locator('[data-ref="apply-observer"]').click();
  await expect(page.locator('[data-ref="location-status"]')).toContainText(
    'Manual location',
  );
  await expect(page.locator('[data-ref="location-chip"]')).toContainText('10.00');
});

test('refraction toggle labels the readout as airless', async ({ page }) => {
  await gotoAt(page, '2029-04-13T22:40:00Z');
  await expect(page.locator('[data-ref="debug-overlay"]')).toContainText('refracted');
  await page.locator('[data-ref="toggle-refraction"]').click();
  await expect(page.locator('[data-ref="debug-overlay"]')).toContainText('airless');
  await expect(page.locator('[data-ref="readout-note"]')).toContainText('Airless');
});

test('measured sky frame time at 4x CPU throttle', async ({ page }) => {
  await gotoAt(page, '2029-04-13T20:45:00Z');
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.locator('[data-ref="speed-select"]').selectOption('600');
  await page.locator('[data-ref="play-button"]').click();
  await page.waitForTimeout(300);
  const stats = await page.evaluate(
    () =>
      new Promise<{ mean: number; p95: number; max: number; frames: number }>((resolve) => {
        const intervals: number[] = [];
        let last = performance.now();
        const tick = (now: number) => {
          intervals.push(now - last);
          last = now;
          if (intervals.length < 150) {
            requestAnimationFrame(tick);
          } else {
            const sorted = [...intervals].sort((a, b) => a - b);
            const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            resolve({
              mean,
              p95: sorted[Math.floor(sorted.length * 0.95)],
              max: sorted[sorted.length - 1],
              frames: intervals.length,
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(
    `Frame timing, sky view, 4x CPU throttle: mean ${stats.mean.toFixed(2)} ms, p95 ${stats.p95.toFixed(2)} ms, max ${stats.max.toFixed(2)} ms over ${stats.frames} frames`,
  );
  expect(stats.p95).toBeLessThan(25);
});

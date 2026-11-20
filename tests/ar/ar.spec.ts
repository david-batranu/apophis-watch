import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SHOTS = resolve(process.cwd(), 'tests/ar/screenshots');

interface DebugData {
  headingTrue?: string;
  pitch?: string;
  screenAngle?: string;
  fov?: string;
  offset?: string;
  apophisX?: string;
  apophisY?: string;
  apophisVisible?: string;
  selectedId?: string;
  selectedX?: string;
  selectedY?: string;
  cameraState?: string;
  sensorState?: string;
  declination?: string;
  declinationStatus?: string;
  compassHeading?: string;
  compassAccuracy?: string;
  timeMode?: string;
  utc?: string;
  alpha?: string;
  beta?: string;
  gamma?: string;
  absolute?: string;
  cameraForward?: string;
  text: string;
}

async function boot(
  page: import('@playwright/test').Page,
  options: { denyCamera?: boolean; denySensors?: boolean; autoOrientation?: boolean } = {},
): Promise<void> {
  await page.addInitScript(
    ({ denyCamera, denySensors, autoOrientation }) => {
      if (denyCamera && navigator.mediaDevices) {
        try {
          Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
            configurable: true,
            value: () =>
              Promise.reject(new DOMException('Permission denied for test', 'NotAllowedError')),
          });
        } catch {
          // ignore
        }
      }
      if (denySensors) {
        class FakeDeviceOrientationEvent extends Event {
          static requestPermission(): Promise<string> {
            return Promise.resolve('denied');
          }
        }
        try {
          Object.defineProperty(window, 'DeviceOrientationEvent', {
            configurable: true,
            value: FakeDeviceOrientationEvent,
          });
        } catch {
          // ignore
        }
      }
      (window as unknown as { __arHarnessAutoOrientation: boolean }).__arHarnessAutoOrientation =
        autoOrientation !== false;
      (window as unknown as { __mockScreenAngle: number }).__mockScreenAngle = 0;
      const fake = {
        get angle() {
          return (window as unknown as { __mockScreenAngle: number }).__mockScreenAngle;
        },
        get type() {
          return 'portrait-primary';
        },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
        lock() {
          return Promise.resolve();
        },
        unlock() {
          return Promise.resolve();
        },
      };
      try {
        Object.defineProperty(screen, 'orientation', {
          configurable: true,
          get() {
            return fake;
          },
        });
      } catch (error) {
        (window as unknown as { __orientationMockError: string }).__orientationMockError =
          String(error);
      }
    },
    {
      denyCamera: options.denyCamera === true,
      denySensors: options.denySensors === true,
      autoOrientation: options.autoOrientation !== false,
    },
  );
  await page.goto('/tests/ar/harness.html?debug=1');
  await page.waitForFunction(
    () => (window as unknown as { __arHarness?: { ready?: boolean } }).__arHarness?.ready === true,
  );
  await expect(page.locator('[data-role="debug"]')).toBeVisible();
  if (options.autoOrientation !== false) {
    await page.waitForFunction(() => {
      const el = document.querySelector<HTMLElement>('[data-role="debug"]');
      return Boolean(el?.dataset.headingTrue && el?.dataset.apophisX);
    });
  } else {
    await page.waitForFunction(() => {
      const el = document.querySelector<HTMLElement>('[data-role="debug"]');
      return Boolean(el?.dataset.cameraState);
    });
  }
  await page.waitForTimeout(500);
}

async function debugData(page: import('@playwright/test').Page): Promise<DebugData> {
  return page.locator('[data-role="debug"]').evaluate((el) => ({
    ...(el as HTMLElement).dataset,
    text: el.textContent ?? '',
  })) as Promise<DebugData>;
}

function num(value: string | undefined): number {
  return Number(value);
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test('overlay follows mocked absolute orientation and screen rotation', async ({ page }) => {
  await boot(page);
  const center = await debugData(page);
  expect(Math.abs(num(center.headingTrue) - 269)).toBeLessThan(2);
  expect(Math.abs(num(center.pitch) - 30)).toBeLessThan(2);
  expect(Math.abs(num(center.apophisX) - 195)).toBeLessThan(30);
  expect(Math.abs(num(center.apophisY) - 422)).toBeLessThan(35);
  expect(center.apophisVisible).toBe('true');
  expect(center.declinationStatus).toBe('supported');
  expect(Math.abs(num(center.declination) - 6.7153)).toBeLessThan(0.02);
  await page.screenshot({ path: resolve(SHOTS, 'ar-01-apophis-centred.png') });

  // Rotate the mocked phone left by 30°: Apophis must move to the right.
  await page.evaluate(() => {
    (
      window as unknown as {
        __arHarness: {
          dispatchOrientation: (options: Record<string, unknown>) => void;
        };
      }
    ).__arHarness.dispatchOrientation({ alpha: 127.715, beta: 120, gamma: 0, absolute: true });
  });
  await page.waitForFunction(
    () =>
      Math.abs(
        Number(
          document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.headingTrue ?? '0',
        ) - 239,
      ) < 2,
  );
  await page.waitForTimeout(450);
  const movedRight = await debugData(page);
  expect(num(movedRight.apophisX)).toBeGreaterThan(num(center.apophisX) + 60);
  await page.screenshot({ path: resolve(SHOTS, 'ar-02-heading-239.png') });

  // Rotate the other way: Apophis must move to the left.
  await page.evaluate(() => {
    (
      window as unknown as {
        __arHarness: {
          dispatchOrientation: (options: Record<string, unknown>) => void;
        };
      }
    ).__arHarness.dispatchOrientation({ alpha: 67.715, beta: 120, gamma: 0, absolute: true });
  });
  await page.waitForFunction(
    () =>
      Math.abs(
        Number(
          document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.headingTrue ?? '0',
        ) - 299,
      ) < 2,
  );
  await page.waitForTimeout(450);
  const movedLeft = await debugData(page);
  expect(num(movedLeft.apophisX)).toBeLessThan(num(center.apophisX) - 60);
  await page.screenshot({ path: resolve(SHOTS, 'ar-03-heading-299.png') });

  // Landscape screen: move to 22:40 UTC, when Apophis is close to the
  // horizon. Screen angle 270 is the top-edge-right pose (W3C/Chrome/Firefox):
  // level pose alpha = 270 - magnetic heading, beta = 0, gamma = 90.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __arHarness: {
          setTime: (ms: number) => void;
          setScreenAngle: (angle: number) => void;
          dispatchOrientation: (options: Record<string, unknown>) => void;
        };
      }
    ).__arHarness;
    harness.setTime(Date.parse('2029-04-13T22:40:00Z'));
    harness.setScreenAngle(270);
    harness.dispatchOrientation({ alpha: 319.07, beta: 0, gamma: 90, absolute: true });
  });
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.screenAngle === '270',
  );
  await page.waitForFunction(() =>
    (document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.utc ?? '').includes(
      '22:40',
    ),
  );
  await page.waitForTimeout(700);
  const landscape = await debugData(page);
  expect(landscape.screenAngle).toBe('270');
  expect(Math.abs(num(landscape.headingTrue) - 317.648)).toBeLessThan(2);
  expect(Math.abs(num(landscape.pitch))).toBeLessThan(2);
  expect(num(landscape.apophisY)).toBeGreaterThan(120);
  expect(num(landscape.apophisY)).toBeLessThan(260);
  await page.screenshot({ path: resolve(SHOTS, 'ar-04-landscape-270.png') });
});

test('FOV slider changes the projected scale', async ({ page }) => {
  await boot(page);
  await page.locator('.ar-panel').first().locator('summary').click();
  // Put Apophis 30° right of centre so a FOV change moves it.
  await page.evaluate(() => {
    (
      window as unknown as {
        __arHarness: {
          dispatchOrientation: (options: Record<string, unknown>) => void;
        };
      }
    ).__arHarness.dispatchOrientation({ alpha: 127.715, beta: 120, gamma: 0, absolute: true });
  });
  await page.waitForTimeout(600);
  const wide = await debugData(page);
  expect(num(wide.fov)).toBe(60);
  const wideX = num(wide.apophisX);

  await page.locator('[data-role="fov"]').evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '80';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.fov === '80',
  );
  await page.waitForTimeout(300);
  const narrow = await debugData(page);
  expect(num(narrow.fov)).toBe(80);
  // A wider FOV shrinks angular offsets towards the centre.
  expect(num(narrow.apophisX)).toBeLessThan(wideX);
  await page.screenshot({ path: resolve(SHOTS, 'ar-05-fov-80.png') });
});

interface AlignTarget {
  id: string;
  name: string;
  azimuthDeg: number;
  elevationDeg: number;
}

async function aimAtTarget(
  page: import('@playwright/test').Page,
  target: AlignTarget,
  biasDeg = -4,
): Promise<void> {
  const debug = await debugData(page);
  const declination = Number(debug.declination ?? 0);
  const offset = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('apophis-ar-calibration-v1');
      return raw ? Number(JSON.parse(raw).headingOffsetDeg) || 0 : 0;
    } catch {
      return 0;
    }
  });
  const magnetic = target.azimuthDeg - declination + biasDeg;
  const alpha = ((360 - magnetic) % 360 + 360) % 360;
  const expectedDisplayHeading = target.azimuthDeg + biasDeg + offset;
  await page.evaluate(
    ({ alphaValue, betaValue }) => {
      (
        window as unknown as {
          __arHarness: {
            dispatchOrientation: (options: Record<string, unknown>) => void;
          };
        }
      ).__arHarness.dispatchOrientation({
        alpha: alphaValue,
        beta: betaValue,
        gamma: 0,
        absolute: true,
      });
    },
    { alphaValue: alpha, betaValue: 90 + target.elevationDeg },
  );
  await page.waitForFunction(
    ({ expected }) => {
      const value = Number(
        document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.headingTrue ?? '0',
      );
      const delta = ((value - expected + 540) % 360) - 180;
      return Math.abs(delta) < 1.2;
    },
    { expected: expectedDisplayHeading },
  );
  await page.waitForTimeout(350);
}

test('one-tap and two-point calibration persist in localStorage', async ({ page }) => {
  await boot(page);
  await page.locator('.ar-panel').first().locator('summary').click();
  const targets = (await page.evaluate(() => {
    return (
      window as unknown as {
        __arHarness: { getAlignTargets: () => AlignTarget[] };
      }
    ).__arHarness.getAlignTargets();
  })) as AlignTarget[];
  expect(targets.length).toBeGreaterThanOrEqual(3);
  await page.locator('[data-role="align-select"]').selectOption(targets[0].id);

  // Give the mock phone a deliberate 4° westward heading bias. One tap should
  // recover +4° and the target should then sit under the reticle.
  await aimAtTarget(page, targets[0], -4);
  await page.locator('[data-role="align"]').click();
  const first = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apophis-ar-calibration-v1') ?? '{}'),
  );
  expect(typeof first.headingOffsetDeg).toBe('number');
  expect(first.headingOffsetDeg).toBeGreaterThan(3);
  expect(first.headingOffsetDeg).toBeLessThan(5);
  expect(first.alignments.length).toBe(1);

  await page.locator('[data-role="align-select"]').selectOption(targets[1].id);
  await aimAtTarget(page, targets[1], -4);
  await page.locator('[data-role="two-point"]').click();
  await page.locator('[data-role="align-select"]').selectOption(targets[2].id);
  await aimAtTarget(page, targets[2], -4);
  await page.locator('[data-role="two-point"]').click();
  const twoPoint = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apophis-ar-calibration-v1') ?? '{}'),
  );
  expect(twoPoint.alignments.length).toBe(3);
  expect(typeof twoPoint.twoPointResidualDeg).toBe('number');
  expect(twoPoint.twoPointResidualDeg).toBeLessThan(0.5);
  const savedOffset = Number(twoPoint.headingOffsetDeg);
  expect(savedOffset).toBeGreaterThan(3);
  expect(savedOffset).toBeLessThan(5);

  // Point back at the third target: with the stored offset it should be
  // near the screen centre.
  await page.waitForTimeout(400);
  const calibrated = await debugData(page);
  expect(Math.abs(num(calibrated.selectedX) - 195)).toBeLessThan(25);
  await page.locator('.ar-panel').first().locator('summary').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(SHOTS, 'ar-06-calibrated.png') });

  await page.reload();
  await page.waitForFunction(
    () => (window as unknown as { __arHarness?: { ready?: boolean } }).__arHarness?.ready === true,
  );
  await page.waitForTimeout(500);
  const afterReload = await debugData(page);
  expect(num(afterReload.offset)).toBeCloseTo(savedOffset, 1);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apophis-ar-calibration-v1') ?? '{}'),
  );
  expect(stored.headingOffsetDeg).toBeCloseTo(savedOffset, 5);
});

test('night mode and touch fallback are usable', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    (
      window as unknown as { __arHarness: { setNight: (night: boolean) => void } }
    ).__arHarness.setNight(true);
  });
  await expect(page.locator('.ar-root')).toHaveClass(/ar-night/);
  const panelColour = await page.locator('.ar-panel').first().evaluate((el) => {
    return getComputedStyle(el).color;
  });
  expect(panelColour).toMatch(/rgb\((2[0-5][0-9]|1[5-9][0-9]),/);
  await page.screenshot({ path: resolve(SHOTS, 'ar-07-night.png') });

  await page.locator('.ar-panel').nth(1).locator('summary').click();
  const before = await debugData(page);
  await page.locator('[data-role="touch-toggle"]').check();
  await expect(page.locator('.ar-root')).toHaveClass(/ar-touch/);
  await page.waitForTimeout(250);
  const afterToggle = await debugData(page);
  expect(num(afterToggle.headingTrue)).toBeCloseTo(num(before.headingTrue), 0);
  const box = await page.locator('[data-role="canvas"]').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 70, box!.y + box!.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const after = await debugData(page);
  expect(num(after.headingTrue)).not.toBeCloseTo(num(before.headingTrue), 0);
  await page.screenshot({ path: resolve(SHOTS, 'ar-08-touch-night.png') });
});

test('two tapped targets solve and change the horizontal FOV', async ({ page }) => {
  await boot(page);
  await page.locator('.ar-panel').first().locator('summary').click();
  const pair = await page.evaluate(() => {
    const harness = (
      window as unknown as {
        __arHarness: {
          getAlignTargets: () => {
            id: string;
            name: string;
            azimuthDeg: number;
            elevationDeg: number;
          }[];
          getProjectedTarget: (
            id: string,
          ) => { x: number; y: number; inFront: boolean; visible: boolean } | null;
        };
      }
    ).__arHarness;
    const targets = harness.getAlignTargets()
      .map((t) => ({ ...t, projected: harness.getProjectedTarget(t.id) }))
      .filter((t) => t.projected?.visible);
    let best: (typeof targets)[number][] | null = null;
    let bestDistance = 0;
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const a = targets[i];
        const b = targets[j];
        const d = Math.hypot(
          b.projected!.x - a.projected!.x,
          b.projected!.y - a.projected!.y,
        );
        if (d > bestDistance) {
          bestDistance = d;
          best = [a, b];
        }
      }
    }
    return best ? { targets: best } : null;
  });
  expect(pair).not.toBeNull();
  const [a, b] = pair!.targets;
  expect(a.name).not.toBe(b.name);
  const box = await page.locator('[data-role="canvas"]').boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.width / 2;
  const cy = box!.height / 2;
  // The projection was made at the default 60° FOV. A 50° projection has
  // focal length f50 = (width/2)/tan(25°), so pixel offsets scale by
  // f50/f60 = tan(30°)/tan(25°).
  const scale = Math.tan((30 * Math.PI) / 180) / Math.tan((25 * Math.PI) / 180);
  const tapA = {
    x: cx + (a.projected!.x - cx) * scale,
    y: cy + (a.projected!.y - cy) * scale,
  };
  const tapB = {
    x: cx + (b.projected!.x - cx) * scale,
    y: cy + (b.projected!.y - cy) * scale,
  };
  expect(tapA.x).toBeGreaterThan(5);
  expect(tapA.x).toBeLessThan(box!.width - 5);
  expect(tapB.x).toBeGreaterThan(5);
  expect(tapB.x).toBeLessThan(box!.width - 5);

  await page.locator('[data-role="fov-target-a"]').selectOption(a.id);
  await page.locator('[data-role="fov-target-b"]').selectOption(b.id);
  await page.locator('[data-role="fov-tap-a"]').click();
  await expect(page.locator('[data-role="tap-capture"]')).toBeVisible();
  await page.mouse.click(box!.x + tapA.x, box!.y + tapA.y);
  await page.waitForTimeout(150);
  await page.locator('.ar-panel').first().locator('summary').click();
  await page.locator('[data-role="fov-tap-b"]').click();
  await expect(page.locator('[data-role="tap-capture"]')).toBeVisible();
  await page.mouse.click(box!.x + tapB.x, box!.y + tapB.y);
  await page.waitForFunction(
    () => Math.abs(Number(document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.fov ?? '0') - 50) < 1,
  );
  const after = await debugData(page);
  expect(num(after.fov)).toBeCloseTo(50, 0);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apophis-ar-calibration-v1') ?? '{}'),
  );
  expect(stored.horizontalFovDeg).toBeCloseTo(50, 0);
  expect(stored.twoPointFov).toBeTruthy();
  expect(stored.twoPointFov.targetAId).toBe(a.id);
  expect(stored.twoPointFov.targetBId).toBe(b.id);
  await page.screenshot({ path: resolve(SHOTS, 'ar-13-fov-two-point.png') });
});

test('WMM warnings update on host time changes without a sensor event', async ({ page }) => {
  await boot(page);
  const check = async (ms: number, pattern: RegExp): Promise<void> => {
    await page.evaluate((utcMs) => {
      (
        window as unknown as { __arHarness: { setState: (patch: object) => void } }
      ).__arHarness.setState({ utcMs });
    }, ms);
    await expect(page.locator('.ar-message').filter({ hasText: pattern })).toBeVisible();
    await page.waitForTimeout(150);
  };
  await check(Date.parse('2024-11-01T00:00:00Z'), /WMM2025 starts 2024-11-13/i);
  // Package boundary is 03:00 UTC mid-day: exercise the intra-day transition.
  await page.evaluate((utcMs) => {
    (
      window as unknown as { __arHarness: { setState: (patch: object) => void } }
    ).__arHarness.setState({ utcMs });
  }, Date.parse('2029-11-13T02:00:00Z'));
  await page.waitForTimeout(150);
  expect((await debugData(page)).declinationStatus).toBe('supported');
  await expect(page.locator('.ar-message').filter({ hasText: /Extrapolated WMM2025/i })).toHaveCount(0);
  await check(Date.parse('2029-11-13T04:00:00Z'), /Extrapolated WMM2025/i);
  await check(Date.parse('2029-11-14T00:00:00Z'), /Extrapolated WMM2025/i);
  await check(Date.parse('2030-01-01T00:00:00Z'), /officially valid to 2029-12-31/i);
  const after = await debugData(page);
  expect(after.declinationStatus).toBe('unsupported');
  expect(after.declination).toBe('');
});

test('rehearsal time input, jump buttons and tonight practice work', async ({ page }) => {
  await boot(page);
  await page.locator('.ar-panel').nth(1).locator('summary').click();
  await page.locator('[data-role="time-input"]').fill('2029-04-13T20:45:00');
  await page.locator('[data-role="time-go"]').click();
  await page.waitForFunction(() =>
    (document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.utc ?? '').includes(
      '20:45:00',
    ),
  );
  const rehearsal = await debugData(page);
  expect(rehearsal.timeMode).toBe('rehearsal');
  expect(Number.isFinite(num(rehearsal.apophisX))).toBe(true);

  await page.locator('[data-jump="topocentricCa"]').click();
  await page.waitForFunction(() =>
    (document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.utc ?? '').includes(
      '21:35:42',
    ),
  );

  await page.locator('[data-mode="tonight"]').click();
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.timeMode === 'tonight',
  );
  await page.waitForTimeout(600);
  const tonight = await debugData(page);
  expect(tonight.timeMode).toBe('tonight');
  expect(tonight.apophisX).toBe('');
  await expect(page.locator('[data-role="reading"]')).toContainText(/Apophis hidden/i);
  expect(tonight.utc).not.toContain('2029-04-13');
  await page.screenshot({ path: resolve(SHOTS, 'ar-12-tonight-practice.png') });
});

test('unmount/remount resets touch mode and keeps one click handler', async ({ page }) => {
  await boot(page);
  await page.locator('.ar-panel').nth(1).locator('summary').click();
  await page.locator('[data-role="touch-toggle"]').check();
  await expect(page.locator('.ar-root')).toHaveClass(/ar-touch/);

  await page.evaluate(() => {
    (
      window as unknown as { __arHarness: { workstream: { unmount: () => void } } }
    ).__arHarness.workstream.unmount();
  });
  await expect(page.locator('.ar-root')).toHaveCount(0);
  await page.evaluate(() => {
    (
      window as unknown as { __arHarness: { workstream: { mount: () => void } } }
    ).__arHarness.workstream.mount();
  });
  await expect(page.locator('[data-role="debug"]')).toBeVisible();
  await page.waitForTimeout(500);

  await expect(page.locator('.ar-root')).not.toHaveClass(/ar-touch/);
  await page.locator('.ar-panel').first().locator('summary').click();
  await expect(page.locator('[data-role="touch-toggle"]')).not.toBeChecked();

  // The sensor path must work again after remount.
  await page.evaluate(() => {
    (
      window as unknown as {
        __arHarness: {
          dispatchOrientation: (options: Record<string, unknown>) => void;
        };
      }
    ).__arHarness.dispatchOrientation({ alpha: 127.715, beta: 120, gamma: 0, absolute: true });
  });
  await page.waitForFunction(
    () =>
      Math.abs(
        Number(
          document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.headingTrue ?? '0',
        ) - 239,
      ) < 2,
  );
  const before = await debugData(page);
  expect(num(before.offset)).toBeCloseTo(0, 1);

  // If the old root click handler leaked, one nudge would apply twice.
  await page.locator('[data-nudge="1"]').click();
  await page.waitForTimeout(150);
  const after = await debugData(page);
  expect(num(after.offset)).toBeCloseTo(1, 1);
  await page.screenshot({ path: resolve(SHOTS, 'ar-14-remount.png') });
});

test('sensor denial keeps its cause and enables touch fallback', async ({ page }) => {
  await boot(page, { denySensors: true, autoOrientation: false });
  await page.locator('[data-role="enable-sensors-top"]').click();
  await expect(page.locator('[data-role="status-sensor"]')).toContainText(/Sensors denied/);
  await expect(page.locator('.ar-message')).toContainText(/Sensor permission denied/i);
  await expect(page.locator('.ar-root')).toHaveClass(/ar-touch/);
  await page.waitForTimeout(3200);
  await expect(page.locator('[data-role="status-sensor"]')).toContainText(/Sensors denied/);
  await expect(page.locator('.ar-message')).toContainText(/denied/i);
  await expect(page.locator('.ar-message')).not.toContainText(/No motion sensor data arrived/i);

  // The denial must survive an unmount/remount rather than degrading to the
  // generic "no sensor data" fallback.
  await page.evaluate(() => {
    (
      window as unknown as { __arHarness: { workstream: { unmount: () => void } } }
    ).__arHarness.workstream.unmount();
  });
  await page.evaluate(() => {
    (
      window as unknown as { __arHarness: { workstream: { mount: () => void } } }
    ).__arHarness.workstream.mount();
  });
  await expect(page.locator('[data-role="debug"]')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-role="status-sensor"]')).toContainText(/Sensors denied/);
  await expect(page.locator('.ar-message')).toContainText(/Sensor permission denied/i);
  await expect(page.locator('.ar-root')).toHaveClass(/ar-touch/);
  await page.locator('.ar-panel').nth(1).locator('summary').click();
  await expect(page.locator('[data-role="touch-toggle"]')).toBeChecked();
  await page.waitForTimeout(3200);
  await expect(page.locator('[data-role="status-sensor"]')).toContainText(/Sensors denied/);
  await expect(page.locator('.ar-message')).toContainText(/Sensor permission denied/i);
  await expect(page.locator('.ar-message')).not.toContainText(/No motion sensor data arrived/i);
});

test('camera state is explicit and the overlay survives a denied/fake camera', async ({ page }) => {
  await boot(page);
  const debug = await debugData(page);
  expect(['live', 'denied', 'unavailable', 'insecure']).toContain(debug.cameraState);
  const status = await page.locator('[data-role="status-camera"]').textContent();
  expect(status).toBeTruthy();
  await page.screenshot({ path: resolve(SHOTS, 'ar-09-camera-state.png') });
});

test('camera denial leaves a working black-background AR overlay', async ({ page }) => {
  await boot(page, { denyCamera: true });
  const debug = await debugData(page);
  expect(debug.cameraState).toBe('denied');
  await expect(page.locator('.ar-message')).toContainText(/Camera permission denied/i);
  expect(num(debug.apophisX)).toBeGreaterThan(0);
  expect(debug.apophisVisible).toBe('true');
  expect(debug.sensorState).toBe('absolute');
  const videoObject = await page.locator('video').evaluate((el) => Boolean((el as HTMLVideoElement).srcObject));
  expect(videoObject).toBe(false);
  await page.screenshot({ path: resolve(SHOTS, 'ar-10-camera-denied.png') });
});

test('iOS-style compass heading is used, and negative accuracy is rejected', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    (
      window as unknown as {
        __arHarness: {
          dispatchOrientation: (options: Record<string, unknown>) => void;
        };
      }
    ).__arHarness.dispatchOrientation({
      type: 'deviceorientation',
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: false,
      compassHeading: 100,
      compassAccuracy: 8,
    });
  });
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.compassHeading === '100',
  );
  await page.waitForTimeout(450);
  const compass = await debugData(page);
  expect(compass.compassHeading).toBe('100');
  expect(compass.compassAccuracy).toBe('8');
  expect(compass.sensorState).toBe('compass');
  expect(Math.abs(num(compass.headingTrue) - 106.715)).toBeLessThan(1);
  await expect(page.locator('[data-role="status-sensor"]')).toContainText(/Compass/);
  await page.screenshot({ path: resolve(SHOTS, 'ar-11-ios-compass.png') });

  // Sub-degree accuracy must not be rounded to ±0° in the detail.
  await page.evaluate(() => {
    (
      window as unknown as {
        __arHarness: {
          dispatchOrientation: (options: Record<string, unknown>) => void;
        };
      }
    ).__arHarness.dispatchOrientation({
      type: 'deviceorientation',
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: false,
      compassHeading: 100,
      compassAccuracy: 0.5,
    });
  });
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.compassAccuracy === '0.5',
  );
  await expect(page.locator('[data-role="error-estimate"]')).toContainText(
    'device compass ±0.5°',
  );
  await expect(page.locator('[data-role="status-accuracy"]')).toContainText('±1.0° est.');

  // A negative webkitCompassAccuracy means "unusable". Wait out the absolute
  // event guard, then send the same heading with accuracy -1.
  await page.waitForTimeout(1300);
  await page.evaluate(() => {
    (
      window as unknown as {
        __arHarness: {
          dispatchOrientation: (options: Record<string, unknown>) => void;
        };
      }
    ).__arHarness.dispatchOrientation({
      type: 'deviceorientation',
      alpha: 0,
      beta: 90,
      gamma: 0,
      absolute: false,
      compassHeading: 100,
      compassAccuracy: -1,
    });
  });
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>('[data-role="debug"]')?.dataset.compassAccuracy === '-1',
  );
  await page.waitForTimeout(300);
  const unusable = await debugData(page);
  expect(unusable.sensorState).toBe('relative');
  await expect(page.locator('.ar-message')).toContainText(/accuracy is reported as unusable/i);
});

import { test, expect } from '@playwright/test';

const BASE =
  '/?lat=45.6427&lon=25.5887&elev=600&eye=0&utc=2029-04-13T20:45:00Z&debug=1';

test('AR tab mounts on black when camera is unavailable and unmounts on leave', async ({
  page,
}) => {
  await page.goto(BASE);
  await page.getByRole('tab', { name: 'AR', exact: true }).click();
  await expect(page.locator('.ar-root')).toBeVisible();
  await expect(page.locator('.ar-debug')).toBeVisible();
  await expect(page.locator('.ar-debug')).toContainText('AR DEBUG');
  const debug = await page.locator('.ar-debug').evaluate((el) => ({
    screen: el.dataset.screenAngle,
    declination: el.dataset.declination,
    declinationStatus: el.dataset.declinationStatus,
    fov: el.dataset.fov,
    camera: el.dataset.cameraState,
    sensor: el.dataset.sensorState,
    utc: el.dataset.utc,
  }));
  expect(debug.screen).toBe('0');
  expect(Number(debug.declination)).toBeGreaterThan(5);
  expect(Number(debug.declination)).toBeLessThan(8);
  expect(debug.declinationStatus).toMatch(/supported/);
  expect(debug.fov).toBe('60');
  expect(debug.camera).toMatch(/unavailable|denied|idle|live|starting/);
  expect(debug.utc).toBe('2029-04-13T20:45:00.000Z');

  await page.locator('.ar-stage').first().screenshot({
    path: 'test-results/phase2/ar-integrated-day.png',
  });
  await page.locator('[data-ref="night-button"]').click();
  await expect(page.locator('.ar-root')).toHaveClass(/ar-night/);
  await page.waitForTimeout(250);
  await page.locator('.ar-stage').first().screenshot({
    path: 'test-results/phase2/ar-integrated-night.png',
  });
  await page.getByRole('tab', { name: 'Sky view', exact: true }).click();
  await expect(page.locator('.ar-root')).toHaveCount(0);
  await expect(page.locator('.sky-canvas')).toBeVisible();
});

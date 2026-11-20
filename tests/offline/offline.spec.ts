import { test, expect } from '@playwright/test';

const BRASOV =
  '/?lat=45.6427&lon=25.5887&elev=591.8&eye=1.7&utc=2029-04-13T20:45:00Z&debug=1';

test('prepare, go offline, and use sky/local/best-spot/AR from the snapshot', async ({
  page,
  context,
}) => {
  await page.goto(`${BRASOV}&view=local`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.tw-root')).toBeVisible();
  await expect(page.locator('[data-ref="offline-card"]')).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  // Keep the test snapshot small enough to run quickly; the real UI lets the
  // user choose larger search/building radii.
  await page.locator('[data-ref="search-radius"]').fill('1000');
  await page.locator('[data-ref="building-radius"]').fill('1000');
  await page.locator('[data-action="prepare-offline"]').click();
  await expect(page.locator('[data-ref="offline-status"]')).toContainText(
    /Prepared .*·.*MB/i,
    { timeout: 180_000 },
  );
  await expect(page.locator('[data-ref="offline-contents"]')).toContainText(
    /Ephemeris/i,
  );
  await expect(page.locator('[data-ref="offline-contents"]')).toContainText(
    /Terrain/i,
  );

  // A second online reload makes the service worker the controller before we
  // cut the network. The snapshot itself is independent of the SW cache.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-ref="offline-line"]')).toContainText(
    /Offline:/i,
  );
  await expect(page.locator('[data-ref="offline-chip"]')).toContainText(
    /Offline: ready/i,
  );

  // Sky readout still works from the prepared ephemeris.
  await page.locator('[data-view="sky"]').click();
  await expect(page.locator('[data-ref="metric-az"]')).not.toHaveText('—');
  await expect(page.locator('[data-ref="metric-el"]')).not.toHaveText('—');

  // Local 3D: cached DEM + offline hillshade + snapshot buildings.
  await page.locator('[data-view="local"]').click();
  await expect(page.locator('.tw-root')).toBeVisible();
  await expect(page.locator('[data-ref="dem-info"]')).toContainText(/cached/i, {
    timeout: 60_000,
  });
  await expect(page.locator('.tw-offline-basemap')).toHaveCount(1);
  await expect(page.locator('[data-ref="building-info"]')).toContainText(
    /buildings|ways/i,
  );
  // The prepared snapshot covers search radius + building radius (2.0 km);
  // it must not be replaced by a narrower stale cache entry.
  await expect(page.locator('[data-ref="building-info"]')).toContainText(
    /query 2\.0 km/i,
  );

  // Best-spot search must run entirely from cached terrain/buildings/path.
  await page.locator('[data-action="run-best"]').click();
  await expect(page.locator('[data-ref="best-status"]')).toContainText(
    /Search complete/i,
    { timeout: 120_000 },
  );
  await expect(page.locator('[data-ref="best-list"] li').first()).toBeVisible();

  // Field-check records are local and persist across an offline reload.
  await page.locator('[data-action="field-pass"]').first().click();
  await expect(page.locator('.tw-field-check')).toContainText(/pass/i);
  const savedFieldChecks = await page.evaluate(() =>
    localStorage.getItem('apophis-field-checks-v1'),
  );
  expect(savedFieldChecks).toContain('pass');

  // AR uses the prepared catalogue/session and the fake camera.
  await page.locator('[data-view="ar"]').click();
  await expect(page.locator('.ar-root')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-role="reading"]')).toContainText(/Apophis/i);

  // An unprepared location must say what does not work, not fail silently.
  await page.goto(
    `${BRASOV.replace('lat=45.6427', 'lat=45.0000').replace(
      'lon=25.5887',
      'lon=25.0000',
    )}&view=local`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.locator('[data-ref="offline-line"]')).toContainText(
    /only prepared for|not prepared/i,
  );
  await expect(page.locator('[data-ref="dem-badge"]')).toContainText(
    /not prepared/i,
  );
});

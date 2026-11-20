import { test, expect } from '@playwright/test';

test('Local 3D tab mounts the Leaflet map with OSM attribution and DEM controls', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(
    '/?lat=45.6427&lon=25.5887&elev=600&eye=1.7&utc=2029-04-13T20:45:00Z&view=local&debug=1',
  );
  await expect(page.locator('.tw-root')).toBeVisible();
  await expect(page.getByText('Terrain, buildings & best spot')).toBeVisible();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.getByText('© OpenStreetMap contributors').first()).toBeVisible();
  await expect(page.getByText('Light pollution', { exact: false }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: 'test-results/phase2/local-tab.png',
    fullPage: false,
  });
  await page.locator('[data-ref="night-button"]').click();
  await expect(page.locator('.tw-root')).toHaveClass(/tw-night/);
  await page.getByRole('button', { name: 'Sky view', exact: true }).click();
  await expect(page.locator('.tw-root')).toBeHidden();
  await page.getByRole('button', { name: 'Local 3D', exact: true }).click();
  await expect(page.locator('.tw-root')).toBeVisible();
});

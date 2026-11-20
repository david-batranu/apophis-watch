import { test, expect } from '@playwright/test';

const OBSERVER =
  'lat=45.6427&lon=25.5887&elev=591.8&eye=1.7&utc=2029-04-13T21:35:42Z';
const SKY = `/?${OBSERVER}&view=sky&debug=1`;

test('phone header does not widen the page and the time dock stays visible', async ({
  page,
}) => {
  await page.goto(SKY);
  await expect(page.locator('[data-ref="time-dock"]')).toBeVisible();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(250);
    const layout = await page.evaluate(() => {
      const dock = document
        .querySelector<HTMLElement>('[data-ref="time-dock"]')!
        .getBoundingClientRect();
      return {
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        dockTop: dock.top,
        dockBottom: dock.bottom,
        dockHeight: dock.height,
        nightVisible: (() => {
          const button = document.querySelector<HTMLElement>(
            '[data-ref="night-button"]',
          )!;
          const rect = button.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth;
        })(),
      };
    });
    expect(layout.documentWidth, `document width at ${width}px`).toBe(
      layout.viewport,
    );
    expect(layout.nightVisible).toBe(true);
    expect(layout.dockHeight).toBeGreaterThanOrEqual(44);
    expect(layout.dockBottom).toBeLessThanOrEqual(844);
  }
});

test('coarse-pointer controls are at least 44px tall', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SKY);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.tab, .btn, .chip-button')]
      .filter((element) => element.offsetParent !== null)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: element.textContent?.trim() ?? '',
          height: rect.height,
        };
      })
      .filter((item) => item.height < 43.5),
  );
  expect(small).toEqual([]);
});

test('time dock scrubs, plays and jumps to closest approach', async ({ page }) => {
  await page.goto(SKY);
  await expect(page.locator('[data-ref="utc-clock"]')).toHaveText(
    '2029-04-13 21:35:42 UTC',
  );

  await page.locator('[data-ref="dock-scrub"]').evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '2500';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('[data-ref="utc-clock"]')).not.toHaveText(
    '2029-04-13 21:35:42 UTC',
  );
  await page.locator('[data-ref="dock-ca"]').click();
  await expect(page.locator('[data-ref="utc-clock"]')).toHaveText(
    '2029-04-13 21:35:42 UTC',
  );

  const play = page.locator('[data-ref="dock-play"]');
  await expect(play).toHaveAttribute('aria-label', 'Play');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Play');

  await page.getByRole('tab', { name: 'Space view', exact: true }).click();
  await expect(page.locator('[data-ref="time-dock"]')).toBeHidden();
});

test('observer controls live with the Local 3D map', async ({ page }) => {
  await page.goto(`/?${OBSERVER}&view=local`);
  const card = page.locator('[data-ref="observer-card"]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-ref="preset"]')).toBeVisible();
  const useLocation = card.getByRole('button', {
    name: 'Use my location',
    exact: true,
  });
  await expect(useLocation).toBeVisible();
  expect(
    await useLocation.evaluate(
      (element) => element.getBoundingClientRect().height,
    ),
  ).toBeGreaterThanOrEqual(43.5);
  await expect(page.locator('[data-ref="lat"]')).toHaveCount(1);
  await expect(page.locator('[data-ref="observer-panel"]')).toHaveCount(0);
});

test('Enter coordinates opens the Local 3D observer card', async ({ page }) => {
  await page.goto('/');
  const dialog = page.locator('[data-ref="location-dialog"]');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Enter coordinates' }).click();
  await expect(page.locator('#tab-local')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const card = page.locator('[data-ref="observer-card"]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-ref="lat"]')).toBeFocused();
});

test('first visit asks for a location without triggering geolocation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __geoAsked: boolean }).__geoAsked = false;
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
      configurable: true,
      value: () => {
        (window as unknown as { __geoAsked: boolean }).__geoAsked = true;
      },
    });
  });
  await page.goto('/');
  const dialog = page.locator('[data-ref="location-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Where are you observing from?');
  expect(
    await page.evaluate(
      () => (window as unknown as { __geoAsked: boolean }).__geoAsked,
    ),
  ).toBe(false);

  await page.locator('[data-ref="dialog-preset"]').selectOption('cape-town');
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-ref="location-chip"]')).toContainText(
    'Cape Town',
  );
  await expect(page.locator('[data-ref="location-chip"]')).toContainText(
    '-33.92',
  );

  await page.reload();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-ref="location-chip"]')).toContainText(
    'Cape Town',
  );
});

test('dismissing the first-visit location card is remembered', async ({
  page,
}) => {
  await page.goto('/');
  const dialog = page.locator('[data-ref="location-dialog"]');
  await expect(dialog).toBeVisible();
  await page.locator('[data-ref="dialog-keep"]').click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-ref="location-chip"]')).toContainText(
    'Brasov preview',
  );
});

test('night mode, display choices and the last view survive a reload', async ({
  page,
}) => {
  await page.goto(`/?${OBSERVER}`);
  await expect(page.locator('[data-ref="min-good-value"]')).toHaveText('10°');
  await page.locator('[data-ref="night-button"]').click();
  await expect(page.locator('body')).toHaveClass(/night/);
  await page.locator('[data-ref="min-good"]').evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('[data-ref="min-good-value"]')).toHaveText('20°');
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: 'Space view', exact: true }).click();
  await expect(page.locator('#tab-space')).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.reload();
  await expect(page.locator('body')).toHaveClass(/night/);
  await expect(page.locator('[data-ref="night-button"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('[data-ref="min-good-value"]')).toHaveText('20°');
  await expect(page.locator('#tab-space')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('AR is not restored on launch, so the camera is never prompted automatically', async ({
  page,
}) => {
  await page.goto(`/?${OBSERVER}`);
  await page.getByRole('tab', { name: 'AR', exact: true }).click();
  await expect(page.locator('#tab-ar')).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(page.locator('#tab-sky')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('a saved location can be forgotten from the location dialog', async ({
  page,
}) => {
  await page.goto('/');
  const dialog = page.locator('[data-ref="location-dialog"]');
  await expect(dialog).toBeVisible();
  await page.locator('[data-ref="dialog-preset"]').selectOption('brasov');
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-ref="location-chip"]')).toContainText(
    'Brasov, Romania',
  );

  await page.locator('[data-ref="location-chip"]').click();
  await expect(dialog).toBeVisible();
  await page.locator('[data-ref="dialog-forget"]').click();
  await expect(dialog).toContainText('Saved location forgotten');
  await page.locator('[data-ref="location-dialog-close"]').click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(dialog).toBeVisible();
});

test.describe('location permission already granted', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: { latitude: 40.4168, longitude: -3.7038 },
  });

  test('starts at the user location without opening the location card', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('[data-ref="location-dialog"]')).toBeHidden();
    await expect(page.locator('[data-ref="location-chip"]')).toContainText(
      'My location',
    );
    await expect(page.locator('[data-ref="location-chip"]')).toContainText(
      '40.42',
    );
    await expect(page.locator('[data-ref="location-chip"]')).not.toContainText(
      'Brasov preview',
    );
  });
});

test('share uses the current location, time and view', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: { title: string; text: string; url: string }) => {
        (window as unknown as { __shared: typeof data }).__shared = data;
        return Promise.resolve();
      },
    });
  });
  await page.goto(SKY);
  await page.locator('[data-ref="share-button"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __shared?: { url: string } }).__shared?.url ??
          '',
      ),
    )
    .toContain('lat=45.64270');
  const shared = await page.evaluate(() => {
    const data = (window as unknown as {
      __shared?: { title: string; text: string; url: string };
    }).__shared;
    return data
      ? {
          ...data,
          params: Object.fromEntries(new URL(data.url).searchParams.entries()),
        }
      : null;
  });
  expect(shared).not.toBeNull();
  expect(shared!.params.lon).toBe('25.58870');
  expect(shared!.params.utc).toBe('2029-04-13T21:35:42Z');
  expect(shared!.params.view).toBe('sky');
  expect(shared!.params.debug).toBeUndefined();
});

test('offline chip offers a neutral save action before preparation', async ({
  page,
}) => {
  await page.goto(SKY);
  const chip = page.locator('[data-ref="offline-chip"]');
  await expect(chip).toContainText('Save offline area');
  await expect(chip).not.toHaveClass(/warn/);
});

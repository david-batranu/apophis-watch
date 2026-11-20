import { test, expect } from '@playwright/test';

const URL =
  '/?lat=45.6427&lon=25.5887&elev=591.8&eye=1.7&utc=2029-04-13T20:45:00Z&view=sky&debug=1';

test('keyboard navigation works for skip link, tabs and sky canvas', async ({
  page,
}) => {
  await page.goto(URL);
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
  ).toBe('Skip to main content');

  await page.locator('#tab-sky').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#panel-space')).toBeVisible();
  await expect(page.locator('#tab-space')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tab-space')).toBeFocused();
  const focusStyle = await page.locator('#tab-space').evaluate((element) => {
    const style = getComputedStyle(element);
    return { outline: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focusStyle.outline).not.toBe('none');
  expect(Number.parseFloat(focusStyle.width)).toBeGreaterThanOrEqual(2);

  await page.keyboard.press('Home');
  await expect(page.locator('#panel-sky')).toBeVisible();

  const before = await page.locator('[data-ref="debug-overlay"]').getAttribute('data-zoom');
  await page.locator('[data-ref="sky-canvas"]').focus();
  await page.keyboard.press('=');
  await page.waitForTimeout(300);
  const after = await page.locator('[data-ref="debug-overlay"]').getAttribute('data-zoom');
  expect(after).not.toBe(before);
  await page.keyboard.press('0');
  await page.waitForTimeout(300);
  await expect(page.locator('[data-ref="debug-overlay"]')).toHaveAttribute(
    'data-zoom',
    '1',
  );
});

test('event-day path direction uses the visible pass, not daylight', async ({
  page,
}) => {
  await page.goto(
    '/?lat=45.6427&lon=25.5887&elev=600&eye=1.7&utc=2029-04-13T21:35:42Z&view=sky',
  );
  const plan = page.locator('[data-ref="event-plan"]');
  await expect(plan).toContainText('124.3');
  await expect(plan).toContainText('319.8');
  await expect(plan).not.toContainText('50.9');
});

test('night contrast and labels are usable', async ({ page }) => {
  await page.goto(URL);
  await page.locator('[data-ref="night-button"]').click();
  const night = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return {
      text: body.getPropertyValue('--text').trim(),
      muted: body.getPropertyValue('--muted').trim(),
      bodyColor: getComputedStyle(document.body).color,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    };
  });
  expect(night.text).toBe('#ff8a7a');
  expect(night.muted).toBe('#d05a4a');
  expect(night.bodyColor).toBe('rgb(255, 138, 122)');
  expect(night.bodyBackground).toBe('rgb(0, 0, 0)');

  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button,input,select')]
      .filter((element) => element.offsetParent !== null)
      .filter((element) => {
        const aria = element.getAttribute('aria-label')?.trim() ?? '';
        const title = element.getAttribute('title')?.trim() ?? '';
        const text = element.textContent?.trim() ?? '';
        const labelText =
          (element as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? '';
        return (aria || title || text || labelText).length === 0;
      })
      .map((element) => element.outerHTML.slice(0, 100)),
  );
  expect(unnamed).toEqual([]);

  await expect(page.locator('[data-ref="about-areas"]')).toContainText(
    '45.6427',
  );
  await expect(page.locator('[data-ref="about-areas"]')).toContainText(
    'endpoint',
  );
  await expect(page.locator('[data-ref="about-areas"]')).toContainText(
    'query',
  );
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('collapses transitions and animations', async ({ page }) => {
    await page.goto(URL);
    const durations = await page.evaluate(() => {
      const button = document.querySelector('.btn');
      return button ? getComputedStyle(button).transitionDuration : '';
    });
    expect(Number.parseFloat(durations)).toBeLessThan(0.001);
  });
});

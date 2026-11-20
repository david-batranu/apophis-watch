/**
 * Phase 5 performance measurement.
 *
 * Usage:
 *   npm run build
 *   npm run measure:perf                 # 10-minute memory session + 3 view samples
 *   npm run measure:perf -- --minutes=2  # shorter smoke run
 *
 * The browser is headless Chromium with 4× CPU throttling. Frame *interval*
 * is reported separately from the time spent inside the frame callback
 * (performance.measure around the render loop). Headless Chromium usually
 * reports SwiftShader software rendering; GPU cost on a real phone is not
 * measured.
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const PORT = 4175;
const BASE = `http://127.0.0.1:${PORT}`;
const URL_BASE =
  '/?lat=45.6427&lon=25.5887&elev=591.8&eye=1.7&utc=2029-04-13T20:45:00Z&debug=1';
const args = process.argv.slice(2);
const minutesArg = args.find((arg) => arg.startsWith('--minutes='));
const sessionMinutes = Math.max(
  1,
  Number(minutesArg?.split('=')[1] ?? 10) || 10,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`preview server did not start on ${BASE}`);
}

async function resetPerf(page) {
  await page.evaluate(() => window.__apophisPerf?.reset());
}

async function perfSummary(page) {
  return page.evaluate(() => {
    const api = window.__apophisPerf;
    if (!api) return null;
    return {
      mainThread: api.summary(900),
      renderer: api.renderer(),
      memory: api.memory(),
    };
  });
}

async function cdpHeap(cdp) {
  try {
    const metrics = await cdp.send('Performance.getMetrics');
    const values = Object.fromEntries(
      metrics.metrics.map((metric) => [metric.name, metric.value]),
    );
    return {
      JSHeapUsedSize: values.JSHeapUsedSize ?? null,
      JSHeapTotalSize: values.JSHeapTotalSize ?? null,
      Nodes: values.Nodes ?? null,
      JSEventListeners: values.JSEventListeners ?? null,
      Documents: values.Documents ?? null,
    };
  } catch {
    return null;
  }
}

async function measureView(page, view, settleMs, sampleMs) {
  await page.goto(`${BASE}${URL_BASE}&view=${view}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => Boolean(window.__apophisPerf), null, {
    timeout: 30_000,
  });
  await sleep(settleMs);
  // Exercise the active render loop, not an idle scene. 60× is enough to
  // update every frame; 600× only changes simulated time.
  await page.evaluate(() => {
    const speed = document.querySelector('[data-ref="speed-select"]');
    if (speed instanceof HTMLSelectElement) {
      speed.value = '60';
      speed.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const play = document.querySelector('[data-ref="play-button"]');
    if (play instanceof HTMLButtonElement && /Play/.test(play.textContent ?? '')) {
      play.click();
    }
  });
  await sleep(1_000);
  await resetPerf(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await sleep(sampleMs);
  const result = await perfSummary(page);
  result.cdpHeap = await cdpHeap(cdp);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.evaluate(() => {
    const play = document.querySelector('[data-ref="play-button"]');
    if (play instanceof HTMLButtonElement && /Pause/.test(play.textContent ?? '')) {
      play.click();
    }
  });
  return result;
}

const preview = spawn(
  'npm',
  ['run', 'preview', '--', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let previewLog = '';
preview.stdout.on('data', (chunk) => {
  previewLog += chunk.toString();
});
preview.stderr.on('data', (chunk) => {
  previewLog += chunk.toString();
});

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    timezoneId: 'Europe/Bucharest',
    colorScheme: 'dark',
    permissions: ['camera'],
  });
  const page = await context.newPage();

  const views = {};
  for (const [view, settle, sample] of [
    ['sky', 2_000, 12_000],
    ['local', 12_000, 12_000],
    ['ar', 5_000, 12_000],
  ]) {
    process.stderr.write(`Measuring ${view}…\n`);
    views[view] = await measureView(page, view, settle, sample);
  }

  // 10-minute session: cycle sky/local/AR every 2 minutes while sampling
  // memory. This catches leaks in the lazy mount/unmount path as well as a
  // long-running render loop.
  process.stderr.write(
    `Running ${sessionMinutes}-minute mixed session and sampling memory…\n`,
  );
  await page.goto(`${BASE}${URL_BASE}&view=sky`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => Boolean(window.__apophisPerf), null, {
    timeout: 30_000,
  });
  // Keep the clock paused for the 10-minute lifecycle/memory run: a 600×
  // playback plus 4× CPU throttle can starve the very tab clicks we need to
  // measure. The per-view samples above already exercise the render loop.
  await page.evaluate(() => {
    const play = document.querySelector('[data-ref="play-button"]');
    if (play instanceof HTMLButtonElement && /Pause/.test(play.textContent ?? '')) {
      play.click();
    }
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const memory = [];
  const started = Date.now();
  const sessionEnd = started + sessionMinutes * 60_000;
  const viewsCycle = ['sky', 'local', 'ar'];
  let cycle = 0;
  while (Date.now() < sessionEnd) {
    const view = viewsCycle[cycle % viewsCycle.length];
    if (cycle > 0) {
      const tab = page.locator(`[data-view="${view}"]`);
      if (await tab.count()) await tab.click({ timeout: 60_000 });
      await sleep(1_500);
    }
    const snapshot = await page.evaluate(() => window.__apophisPerf?.memory() ?? null);
    const main = await page.evaluate(() =>
      window.__apophisPerf?.summary(900) ?? null,
    );
    const heap = await cdpHeap(cdp);
    memory.push({
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      view,
      memory: snapshot,
      cdpHeap: heap,
      mainThread: main,
    });
    process.stderr.write(
      `  ${Math.round((Date.now() - started) / 1000)}s ${view} heap ${
        heap?.JSHeapUsedSize
          ? (heap.JSHeapUsedSize / 1024 / 1024).toFixed(1)
          : snapshot
            ? (snapshot.usedJSHeapSize / 1024 / 1024).toFixed(1)
            : '?'
      } MiB · listeners ${heap?.JSEventListeners ?? '?'}\n`,
    );
    cycle++;
    await sleep(Math.min(60_000, Math.max(1_000, sessionEnd - Date.now())));
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const output = {
    generatedAt: new Date().toISOString(),
    viewport: '390x844',
    cpuThrottle: 4,
    sessionMinutes,
    sessionPlayback: 'paused (tab lifecycle / memory only)',
    views,
    sessionMemory: memory,
    note:
      'Headless Chromium. Frame interval is display-cadence-capped; mainThread is performance.measure around the render callback. GPU cost on a physical phone is not measured. SwiftShader renderer indicates software rendering.',
  };
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/perf.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(error);
  console.error(previewLog.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  preview.kill('SIGTERM');
}

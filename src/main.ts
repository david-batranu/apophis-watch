import './styles.css';
import { jdTdbFromDate } from './core/time';
import { AppModel } from './state/appModel';
import { solarSystemBodies, type BodyPosition } from './sky/bodies';
import { AppUi } from './ui/app';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app');
  const app = new AppModel();
  await app.init();
  const ui = new AppUi(root, app, app.getCatalogue());

  let last = performance.now();
  let lastReadout = 0;
  let lastPlot = 0;
  let bodyCacheKey = '';
  let bodyCache: BodyPosition[] = [];

  const frame = (now: number): void => {
    const dt = Math.min(100, now - last);
    last = now;
    app.advance(dt);
    const state = app.getState();
    const session = app.getSession();
    if (session && state.utcMs !== null) {
      const sky = session.skyAt(state.utcMs, state.toggles.refraction);
      // Sun/Moon/planets move slowly; 5 simulated minutes is far below one
      // pixel at the dome scale. Cache them to keep 60 fps headroom.
      const bodyKey = [
        Math.floor(state.utcMs / 300_000),
        state.toggles.refraction,
        session.observer.latitudeDeg,
        session.observer.longitudeDeg,
        session.observer.elevationM,
      ].join('|');
      if (bodyKey !== bodyCacheKey) {
        bodyCacheKey = bodyKey;
        bodyCache = solarSystemBodies(
          session.observer,
          jdTdbFromDate(new Date(state.utcMs)),
          state.toggles.refraction,
        );
      }
      ui.renderViews(state, sky, bodyCache);
      if (now - lastReadout > 100) {
        ui.updateFrame(state, sky, bodyCache);
        lastReadout = now;
      }
      if (now - lastPlot > 300) {
        ui.updatePlot(state);
        lastPlot = now;
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((error) => {
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML = `<main class="main"><section class="panel"><h2>Startup error</h2><p class="status-line error">${String(
      error,
    )}</p><p class="status-line">Check that public/data/apophis-2029.json is served and reload.</p></section></main>`;
  }
  console.error(error);
});

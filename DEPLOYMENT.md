# Deployment

Apophis Watch is a static Vite PWA. There is no backend, account or analytics.
`npm run build` writes `dist/`; upload that directory (or connect the repository
to a static host and use `npm run build` as the build command).

## HTTPS is mandatory

Service workers, the camera (`getUserMedia`), device orientation and browser
geolocation are secure-context features. `http://localhost` is treated as
secure for development, but a phone on the LAN needs HTTPS:

- `npm run dev:https` uses `@vitejs/plugin-basic-ssl` and a generated
  certificate. The phone must accept the warning. iOS may still refuse camera
  or motion permission on an untrusted certificate; use a locally trusted
  certificate (for example `mkcert`) for serious iPhone testing.
- GitHub Pages and Cloudflare Pages both provide trusted HTTPS on their
  domains and custom domains.

## Recommended: Cloudflare Pages (root domain)

Cloudflare Pages is recommended because it supports `_headers` (the repository
ships `public/_headers`), native SPA fallback, and unlimited static bandwidth.

1. Push the repository to GitHub/GitLab.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Build command: `npm run build`
4. Build output directory: `dist`
5. Node version: 20 or newer.
6. Add a custom domain if you want one; HTTPS is automatic.
7. After the first deploy, open the site once online and add it to the home
   screen on the phone.

`public/_headers` sets:

- `sw.js` and `workbox-*.js` to `no-cache` (so an update is discovered),
- hashed `/assets/*` to a one-year immutable cache,
- `/data/*` to a short cache (data is a live file, not the prepared snapshot),
- camera/geolocation permissions and basic security headers.

Cloudflare Pages serves at a domain/subdomain root. It does **not** natively
host multiple projects under one domain's sub-path; use a subdomain instead.

## GitHub Pages (root or sub-path)

GitHub Pages is fine for a personal build, but it does not support custom
response headers and has a soft 100 GB/month bandwidth limit.

- Build: `npm run build`
- Publish `dist/` to the `gh-pages` branch or use the official Pages Actions.
- The repository includes `public/.nojekyll` so underscored files are served.
- `base: './'` in `vite.config.ts` makes the build work at a root domain and at
  `https://<user>.github.io/<repo>/` without changing the config.
- Because there are no client-side routes (only query parameters), a `404.html`
  SPA shim is not required. If you later add path routes, add `dist/404.html`
  as a copy of `index.html`.
- GitHub Pages may cache `sw.js` for up to about 10 minutes. The app still
  prompts when an update is found; for immediate updates use Cloudflare Pages
  or a host that lets you set `Cache-Control: no-cache` on `sw.js`.

## Root domain versus sub-path

The app uses relative asset URLs (`base: './'`), so the same build works at
both:

- root: `https://apophis.example/`
- sub-path: `https://example.github.io/apophis-watch/`

The service worker is registered relative to the deployment base, so its scope
is the deployment directory. Do not place two different builds under the same
scope; the service worker would control both.

## Offline cache size and host limits

The prepared snapshot is stored on the device in IndexedDB, not on the host.
A typical z14 area is about 15 × 15 km (81 tiles) and can be 5–25 MB depending
on the building count. Cloudflare Pages allows 25 MiB per file; GitHub Pages
allows a 1 GB published site. Neither host limit is the constraint — the
phone's storage quota and Safari's eviction policy are.

## Updating the app

The service worker is built with `registerType: 'prompt'` and
`skipWaiting: false`. A new build installs into a waiting worker; the app shows
a reload banner. The old shell keeps working offline until the user reloads.
Prepared offline data lives in IndexedDB and is not touched by a service-worker
update.

## Refreshing the committed data

```bash
npm ci
npm run fetch:ephemeris   # JPL Horizons; updates public/data/apophis-2029.json
npm run fetch:stars       # HYG + ConstellationLines; updates public/data/stars.json
npm run fetch:buildings -- --lat=45.6427 --lon=25.5887 --radius=1500 --name=brasov
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run test:offline
```

`fetch:ephemeris` also refreshes the independent Horizons validation truth. Run
`npm run report:phase1` afterwards if you want to regenerate
`PHASE1-VALIDATION.md`. Review the diff: the retrieval date and solution ID are
recorded in the JSON and shown in the About panel. A prepared offline snapshot
is **not** silently replaced by a page refresh; the user must press
**Prepare for offline** again to adopt the new data.

## Building the optional bundled building areas

`npm run fetch:buildings -- --lat=... --lon=... --radius=... --name=...`
writes a GeoJSON file plus metadata sidecar under `public/data/areas/` and
updates `index.json`. The app checks this manifest before making a live
Overpass request. Bundled building data is ODbL; keep the attribution and do
not publish it without the ODbL notice. If every Overpass mirror fails, the
script exits non-zero and writes nothing; import a GeoJSON/Overpass file by
hand in Local 3D instead.

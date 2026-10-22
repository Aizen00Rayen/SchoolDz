# Plan: move the web frontend from Create React App (craco) to Vite

Status: **planned, not started**. Written 2026-10-22.

## Why

- `react-scripts` (Create React App) is no longer maintained. `npm audit`
  reports ~100 advisories (2 critical, ~60 high), and all of them come
  from its build/test toolchain (webpack-dev-server, jest 27, svgo,
  eslint 8 plugins…). They can't be fixed while we're on CRA.
- The browser bundle itself is already clean: `axios`, `ajv`,
  `fast-uri` and `follow-redirects` were upgraded on 2026-10-22.
- Vite starts the dev server in about a second instead of ~30 s, rebuilds
  instantly, and its production builds are several times faster.
- Removing `@craco/craco` drops ~120 lines of webpack-dev-server
  compatibility patches in `craco.config.js`.

## What the codebase looks like today (checked)

| Item | Today | Impact |
|---|---|---|
| Source files | 111 `.jsx`, 13 `.js` | Only `src/index.js` and `src/App.js` contain JSX → rename to `.jsx` |
| Env vars | Only `process.env.REACT_APP_BACKEND_URL` (in `src/lib/api.js`) | One-line change |
| Path alias | `@/` → `src/` (jsconfig + craco) | Add `resolve.alias` in Vite |
| `public/index.html` | Uses `%PUBLIC_URL%` 6× | Move to `frontend/index.html`, drop `%PUBLIC_URL%`, add `<script type="module" src="/src/index.jsx">` |
| Styles | Tailwind 3 + PostCSS config | Works unchanged in Vite |
| Asset imports | Only CSS imports | No SVG-as-component (`svgr`) needed |
| Tests | No frontend tests | Nothing to port; add Vitest later if wanted |
| craco health-check plugin | Dev-only, behind `ENABLE_HEALTH_CHECK` | Drop it (not used in production) |
| Build output | `frontend/build/`, JS/CSS in `build/static/` | **Keep the same layout** (see below) |

### Things that depend on the build layout (must keep working)

- `django-backend/schooldz/settings.py`: `FRONTEND_BUILD_DIR = frontend/build`
  and `STATICFILES_DIRS = [build/static]`.
- `api/views/public.py::serve_frontend` serves `build/index.html`.
- VPS deploy (README): `cp -r frontend/build/* /var/www/scolaris.cloud/`.
- PythonAnywhere deploy: static mapping `/static/` → `frontend/build/static`.
- `frontend/build/` is committed on purpose (PythonAnywhere free tier can't run
  `npm install`).

So Vite must output to `build/` with assets under `build/static/`:

```js
// frontend/vite.config.js
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["VITE_", "REACT_APP_"]);
  return {
    plugins: [react()],
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },
    envPrefix: ["VITE_", "REACT_APP_"],      // keeps REACT_APP_BACKEND_URL working during the switch
    server: { port: 3000, strictPort: true },
    build: {
      outDir: "build",
      assetsDir: "static",
      sourcemap: false,                         // same as GENERATE_SOURCEMAP=false today
      target: "es2019",
    },
  };
});
```

`envPrefix` with `REACT_APP_` lets `.env`, `.env.production` and
`launch.sh` stay as they are. Vite applies `.env.production` over `.env` for
builds, which is the same precedence the 2026-08-27 incident fix put into
`craco.config.js`.

## Steps

1. **Branch**: `git switch -c chore/vite`.
2. **Dependencies**
   ```bash
   cd frontend
   npm remove react-scripts @craco/craco cra-template @babel/plugin-proposal-private-property-in-object
   npm install -D vite@^5 @vitejs/plugin-react@^4
   ```
   Remove the CRA-only `overrides` entries in `package.json` (webpack-dev-server,
   jest, svgo, resolve-url-loader, css-loader…) once they're no longer in the tree.
3. **Files**
   - `git mv src/index.js src/index.jsx` and `git mv src/App.js src/App.jsx`.
   - `git mv public/index.html index.html`; remove `%PUBLIC_URL%`; add
     `<script type="module" src="/src/index.jsx"></script>` before `</body>`.
   - Add `vite.config.js` (above). Delete `craco.config.js` and `plugins/health-check/`.
   - `src/lib/api.js`: `process.env.REACT_APP_BACKEND_URL` →
     `import.meta.env.REACT_APP_BACKEND_URL` (rename to `VITE_BACKEND_URL` in a later cleanup).
4. **Scripts** in `package.json`:
   `"start": "vite"`, `"dev": "vite"`, `"build": "vite build"`, `"preview": "vite preview --port 3000"`.
5. **Tooling**
   - `launch.sh`: change `pkill -f .../craco` to `pkill -f .../vite`; `npm start` still works.
   - `.claude/launch.json`: the `frontend-debug` entry calls `npx craco start` → `npx vite --port 3002`.
   - ESLint: `eslint-config-react-app` goes away with CRA. Add `eslint.config.js`
     (flat config) with `eslint-plugin-react`, `react-hooks` and `jsx-a11y`; these are already in devDependencies.
6. **Verify**
   - `npm run dev`: log in, click through every sidebar page in AR (RTL), FR and EN, dark and light.
   - `npm run build` then check `build/index.html` and `build/static/*.js|css` exist.
   - Run Django with `APP_DEBUG=false` serving `build/` (PythonAnywhere mode) and
     load `/`, `/app/dashboard` and `/enroll/<slug>` to confirm deep links and static files.
   - Print views (Reports, Archive, invoices) and file downloads (CSV/XLSX/PDF).
   - `npm audit --omit=dev` should drop to only runtime findings (currently 0).
7. **Deploy docs**: update README and `PYTHONANYWHERE_DEPLOY.md` (`npm run build`
   stays the same; only mention Vite where CRA is named).
8. **Rollback**: everything is on one branch; reverting the merge restores CRA.

## Estimate and risks

- About half a day of work plus a full click-through test.
- Risk: a dependency that expects `process.env` or Node `global` in the browser.
  Fix with `define: { "process.env": {} }` in `vite.config.js` if one shows up.
- Risk: browserslist targets. CRA used `>0.2%, not dead`; `target: "es2019"`
  covers the same range.

## Later (optional)

- Rename `REACT_APP_BACKEND_URL` → `VITE_BACKEND_URL` and drop the `REACT_APP_` prefix.
- Add Vitest + React Testing Library for the finance forms (payments, teacher payments).
- Stop committing `frontend/build/`: build it in a GitHub Actions workflow and
  publish it to a `deploy` branch or a release that the VPS and PythonAnywhere pull from.

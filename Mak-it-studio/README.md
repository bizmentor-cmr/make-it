# Make it Studio

Make it Studio is the creative workspace companion to Make It. It brings image, video, audio, cinema, workflow, and design-agent tools together in one interface, with both a web application and an optional Electron desktop build.

## Run locally

From this directory:

```bash
npm install
npm run dev
```

The Studio web app runs at [http://localhost:3001](http://localhost:3001). The root Make It application can start both projects together with `npm run dev:all` from the repository root.

## Desktop application

The optional Electron shell uses the same Make it Studio branding:

```bash
npm run electron:dev
```

Build installers with `npm run electron:build` (macOS), `npm run electron:build:win` (Windows), or `npm run electron:build:linux` (Linux). Build artifacts are written to `release/`.

## Local inference

In the desktop build, open **Settings → Local Models** to install the local inference engine or configure a Wan2GP server. To store model files on another drive, set `MAKE_IT_STUDIO_LOCAL_AI_DIR` before launching the desktop app.

## Project structure

- `app/` — Next.js routes and page metadata
- `components/` — standalone Studio shell, navigation, and API key modal
- `electron/` — Electron main process and local inference integrations
- `packages/studio/` — shared creative tools and model integrations
- `packages/Vibe-Workflow/` — visual workflow builder
- `public/` — Studio assets and brand mark
- `scripts/` — packaging and local AI staging utilities

## Configuration

Generation features use a MuAPI access key. Enter the key in the Studio when prompted; it is stored locally by the app. Keep API keys private and do not commit them to the repository.

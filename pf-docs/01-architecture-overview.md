# PEAK DJ Command Architecture Overview

## Metadata
| Field | Value |
|-------|-------|
| Repository | `peak-codex-dac` ([github.com/peak-flow/react-codex-dac](https://github.com/peak-flow/react-codex-dac)) |
| Commit | `eb2e526` |
| Documented | `2026-03-18` (updated) |
| Prior Commit | `50c837f` |
| Verification Method | `LSP-equivalent (structured file reading)` |

## Verification Summary
- [VERIFIED]: 45 claims
- [INFERRED]: 4 claims
- [NOT_FOUND]: 8 items (routing, Redux, backend server, tests, database, auth, CI/CD, env config)
- [ASSUMED]: 1 item (Vite SPA conventions)
- [RESOLVED]: 1 issue (analysis queue deadlock, fixed at `eb2e526`)

---

## 0. System Classification
| Field | Value |
|-------|-------|
| Type | Desktop Electron application with React SPA renderer |
| Evidence | `package.json:6` main entry `electron/main.cjs`; `package.json:14-17` dependencies `react`, `react-dom`; `electron/` directory with `main.cjs` and `preload.cjs` [VERIFIED] |
| Confidence | `[VERIFIED]` |

---

## 1. System Purpose

PEAK DJ Command is a **desktop-first DJ MVP** built with Electron and React. It provides a two-deck command center for DJs, combining local audio library scanning and analysis (BPM, key, energy, waveform) with Spotify metadata import. The system merges local and Spotify track libraries, generates smart crates based on energy and harmonic properties, scores transition suggestions between tracks, and provides real-time playback with waveform visualization and sync controls.

[VERIFIED: `package.json:5` description: "Desktop-first DJ MVP with Spotify metadata import, local library analysis, and pro-deck workflows."]

---

## 2. Component Map

### Electron Main Process

| Component | Location | Responsibility | Evidence |
|-----------|----------|----------------|----------|
| Main Process | `electron/main.cjs` | Electron app lifecycle, BrowserWindow creation, IPC handlers, file system access, Spotify OAuth PKCE flow | [VERIFIED: `electron/main.cjs:1-578`] |
| Preload Script | `electron/preload.cjs` | Context bridge exposing `window.appAPI` with 8 IPC methods | [VERIFIED: `electron/preload.cjs:1-12`] |

**Main Process Functions (via file reading):**
- `createWindow` -- BrowserWindow with hiddenInset titlebar, context isolation
- `walkMusicFiles` -- recursive directory walker filtering by audio extensions
- `parseLocalTrack` -- metadata extraction via `music-metadata` package
- `startSpotifyAuth` -- PKCE OAuth flow with local HTTP callback server on port 47832
- `spotifyFetch`, `spotifyPaginated` -- authenticated Spotify API client with rate-limit retry and token refresh
- `importSpotifyLibrary` -- imports saved tracks and playlists from Spotify
- `mapSpotifyTrack` -- transforms Spotify API track objects into app Track schema
- `buildTrackId`, `guessMimeType`, `fallbackTitleFromFile` -- utility functions

**IPC Handlers (7 registered via `ipcMain.handle`):**
[VERIFIED: `electron/main.cjs:530-578`]
- `library:select-folder` -- native folder picker dialog
- `library:scan-folder` -- walks directory tree and parses audio metadata
- `library:read-audio-file` -- reads raw audio file bytes
- `shell:open-external` -- opens URLs in system browser
- `spotify:login` -- initiates Spotify PKCE auth
- `spotify:sync` -- imports full Spotify library
- `spotify:logout` -- clears session
- `spotify:redirect-uri` -- returns the Spotify redirect URI

### React Renderer Components

| Component | Location | Responsibility | Evidence |
|-----------|----------|----------------|----------|
| App | `src/App.tsx` | Root component: all application state, audio context, analysis queue (ref-based mutex), deck management, Spotify orchestration | [VERIFIED: `src/App.tsx:1-707`] |
| DeckPanel | `src/components/DeckPanel.tsx` | Single DJ deck with playback controls, waveform, seek/pitch/volume faders, cue points, sync | [VERIFIED: `src/components/DeckPanel.tsx:1-333`] |
| Waveform | `src/components/Waveform.tsx` | Scrollable, zoomable SVG waveform with 6 zoom levels (Full to 2 bars), BPM-aware default zoom (8-bar), auto-scroll following playhead, bar-level grid at zoom >= 4x, beat phrase markers, cue point indicators | [VERIFIED: `src/components/Waveform.tsx:1-167`] |
| LibraryTable | `src/components/LibraryTable.tsx` | Scrollable track table with BPM, key, energy, source columns and Load A/B actions | [VERIFIED: `src/components/LibraryTable.tsx:1-89`] |
| Sidebar | `src/components/Sidebar.tsx` | Library stats, scan/analyze actions, Spotify Bridge config, crate navigation | [VERIFIED: `src/components/Sidebar.tsx:1-160`] |
| InsightPanel | `src/components/InsightPanel.tsx` | AI transition coach, smart suggestions with scoring, set arc summary | [VERIFIED: `src/components/InsightPanel.tsx:1-81`] |

### Core Library Modules

| Module | Location | Responsibility | Evidence |
|--------|----------|----------------|----------|
| djEngine | `src/lib/djEngine.ts` | Musical key normalization, Camelot wheel, library merging, crate generation, transition scoring, mix narrative generation, set arc summary | [VERIFIED: `src/lib/djEngine.ts:1-679`] |
| audioAnalysis | `src/lib/audioAnalysis.ts` | Client-side audio analysis: BPM estimation (onset envelope + autocorrelation), key estimation (Goertzel + Krumhansl-Schmuckler profiles), energy (RMS), waveform bucketing | [VERIFIED: `src/lib/audioAnalysis.ts:1-313`] |

### Type System

| File | Location | Responsibility | Evidence |
|------|----------|----------------|----------|
| types | `src/types.ts` | Shared TypeScript interfaces: Track, TrackAnalysis, DeckState, Crate, TransitionSuggestion, SetArcSummary, SpotifyProfile, SpotifyPlaylist, SpotifyImport, plus type aliases for DeckId, TrackSource, SortKey, SourceFilter, etc. | [VERIFIED: `src/types.ts:1-119`] |
| vite-env.d.ts | `src/vite-env.d.ts` | Global `window.appAPI` type declaration bridging renderer to Electron IPC | [VERIFIED: `src/vite-env.d.ts:1-24`] |

[NOT_FOUND: searched for "Router", "Route", "react-router" in `src/` -- no routing library]
No client-side routing. The app is a single-view SPA.

[NOT_FOUND: searched for "redux", "store", "zustand", "context" providers in `src/` -- no state management library]
No external state management. All state lives in the root `App` component via `useState`/`useRef`/`useMemo`.

[NOT_FOUND: searched for "test", "spec", "vitest", "jest" -- no test files or test configuration]
No test suite exists.

---

## 3. Execution Surfaces & High-Level Data Movement (Discovery Only)

### 3.1 Primary Execution Surfaces

| Entry Surface | Type | Primary Components | Evidence |
|--------------|------|--------------------|----------|
| Electron main process startup | Desktop App | `electron/main.cjs:createWindow()`, `app.whenReady()` | [VERIFIED: `electron/main.cjs:514-522`] |
| React renderer mount | SPA Render | `src/main.tsx` -> `App` | [VERIFIED: `src/main.tsx:1-4`] |
| IPC: `library:select-folder` | User Action (Scan) | Main process dialog -> renderer | [VERIFIED: `electron/main.cjs:530-541`] |
| IPC: `library:scan-folder` | User Action (Scan) | `walkMusicFiles`, `parseLocalTrack` | [VERIFIED: `electron/main.cjs:543-556`] |
| IPC: `library:read-audio-file` | User Action (Analysis) | File system read via `fs.readFile` | [VERIFIED: `electron/main.cjs:558-561`] |
| IPC: `spotify:login` | User Action (Connect) | `startSpotifyAuth` -> PKCE flow -> local HTTP server on 47832 | [VERIFIED: `electron/main.cjs:569`] |
| IPC: `spotify:sync` | User Action (Sync) | `importSpotifyLibrary` -> paginated Spotify API calls | [VERIFIED: `electron/main.cjs:571`] |
| Client-side audio analysis | Background Processing | `analyzeAudioFile` in `src/lib/audioAnalysis.ts` via Web Audio API | [VERIFIED: `src/lib/audioAnalysis.ts:292-313`] |
| Track load to deck | User Action (Play) | `handleLoadTrack` in `App.tsx` -> `DeckPanel` HTML5 Audio element | [VERIFIED: `src/App.tsx:378-404`] |

### 3.2 High-Level Data Movement

| Stage | Input | Output | Components |
|-------|-------|--------|------------|
| Folder scan | User-selected directory path | Array of `Track` objects with metadata from audio file tags | `electron/main.cjs` (walkMusicFiles, parseLocalTrack, music-metadata) |
| Spotify import | Spotify Client ID + OAuth token | `SpotifyImport` (profile, savedTracks, playlists) | `electron/main.cjs` (startSpotifyAuth, importSpotifyLibrary, spotifyFetch) |
| Library merge | localTracks + spotifyTracks + spotifyPlaylists | Unified `Track[]` + `Crate[]` (system, folder, spotify, smart crates) | `src/lib/djEngine.ts` (mergeTrackLibraries) |
| Audio analysis | ArrayBuffer from file read | `TrackAnalysis` (bpm, key, energy, waveform) | `src/lib/audioAnalysis.ts` (analyzeAudioFile) via Web Audio API |
| Transition scoring | Reference track + candidate pool | Ranked `TransitionSuggestion[]` with BPM/key/energy/tag scores | `src/lib/djEngine.ts` (getTransitionSuggestions, scoreTransition) |
| Deck playback | Track file path | Blob URL -> HTML5 `<audio>` element | `App.tsx` (getPlaybackUrl), `DeckPanel.tsx` (audio ref) |

### 3.3 Pointers to Code Flow Documentation

List of operations that SHOULD be traced in detail (in 02-code-flows.md):
- **Folder scan + metadata parse** -- from dialog selection through walkMusicFiles to parseLocalTrack to renderer state
- **Spotify PKCE OAuth flow** -- the full auth code + token exchange + local callback server lifecycle
- **Library merge and matching** -- ISRC and fingerprint-based matching between local and Spotify tracks
- **Analysis pipeline** -- queue management (ref-based mutex), buffer read via IPC, AudioContext decode, BPM/key/energy estimation, state update (see `pf-docs/02-code-flow-analysis-pipeline.md`)
- **Transition suggestion scoring** -- scoreTransition algorithm with Camelot adjacency, BPM gap, energy delta
- **Deck load and playback** -- from load action to blob URL creation to HTML5 audio control

---

## 3b. Frontend -> Backend Interaction Map

In this Electron architecture, "frontend" is the React renderer process and "backend" is the Electron main process, bridged by IPC.

| Frontend Source | Trigger Type | Backend Target | Handler | Evidence |
|-----------------|--------------|----------------|---------|----------|
| `App.handleScanFolder()` | Button click | `ipcMain: library:select-folder` + `library:scan-folder` | `dialog.showOpenDialog`, `walkMusicFiles`, `parseLocalTrack` | [VERIFIED: `src/App.tsx:423-471`, `electron/main.cjs:530-556`] |
| `App.readTrackBuffer()` | Analysis queue tick | `ipcMain: library:read-audio-file` | `fs.readFile` | [VERIFIED: `src/App.tsx:245-259`, `electron/main.cjs:558-561`] |
| `App.handleSpotifyConnect()` | Button click | `ipcMain: spotify:login` | `startSpotifyAuth` (PKCE + local HTTP) | [VERIFIED: `src/App.tsx:473-491`, `electron/main.cjs:569`] |
| `App.handleSpotifySync()` | Button click | `ipcMain: spotify:sync` | `importSpotifyLibrary` | [VERIFIED: `src/App.tsx:493-513`, `electron/main.cjs:571`] |
| `App.handleSpotifyLogout()` | Button click | `ipcMain: spotify:logout` | Session clear | [VERIFIED: `src/App.tsx:515-521`, `electron/main.cjs:573-576`] |
| `App.handleOpenExternal()` | Button click | `ipcMain: shell:open-external` | `shell.openExternal` | [VERIFIED: `src/App.tsx:374-376`, `electron/main.cjs:563-567`] |
| Startup | App mount | `ipcMain: spotify:redirect-uri` | Returns constant URI | [VERIFIED: `src/App.tsx:202`, `electron/main.cjs:578`] |

---

## 4. File/Folder Conventions

[VERIFIED: file tree scan]

```
peak-codex-dac/
├── electron/
│   ├── main.cjs              # Electron main process (CommonJS)
│   └── preload.cjs            # Context bridge (CommonJS)
├── src/
│   ├── main.tsx               # React entry point
│   ├── App.tsx                # Root component (all state)
│   ├── types.ts               # Shared TypeScript interfaces
│   ├── vite-env.d.ts          # Global type declarations for window.appAPI
│   ├── styles.css             # Single global stylesheet ("Forest Night" dark theme)
│   ├── components/
│   │   ├── DeckPanel.tsx      # DJ deck with playback
│   │   ├── Waveform.tsx       # SVG waveform visualization
│   │   ├── LibraryTable.tsx   # Track listing table
│   │   ├── InsightPanel.tsx   # AI suggestions sidebar
│   │   └── Sidebar.tsx        # Library/Spotify/Crates navigation
│   └── lib/
│       ├── djEngine.ts        # DJ logic (merge, score, format, crates)
│       └── audioAnalysis.ts   # Client-side BPM/key/energy analysis
├── pf-docs/
│   ├── 01-architecture-overview.md  # This document
│   ├── 02-code-flow-analysis-pipeline.md
│   ├── CODE-FLOW-RECOMMENDATIONS.md
│   └── codemap.json                 # Structured code map
├── dj-theme-playground.html   # Standalone theme visual playground (not app source)
├── waveform-playground.html   # Standalone waveform visual playground (not app source)
├── analysis-pipeline-flow.html # Analysis pipeline flow visualization (not app source)
├── index.html                 # HTML shell
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript strict config
└── vite.config.ts             # Vite + React SWC plugin
```

**Patterns observed:**
- Electron files use `.cjs` extension (CommonJS) while renderer uses `.tsx`/`.ts` (ESM) [VERIFIED]
- Components are pure presentational -- all state is hoisted to `App.tsx` [VERIFIED]
- No pages/routing directory -- single-view architecture [VERIFIED]
- `lib/` contains pure logic modules with no React dependencies (except `audioAnalysis.ts` using Web Audio API) [VERIFIED]
- Single CSS file for the entire application, no CSS modules or CSS-in-JS [VERIFIED]
- Standalone `*-playground.html` files in root are visual prototyping aids, not part of the built application [VERIFIED]
- `pf-docs/` contains architecture documentation and code maps [VERIFIED]

---

## 5. External Dependencies

### Runtime Dependencies
[VERIFIED: `package.json:14-17`]

| Dependency | Version | Purpose | Evidence |
|------------|---------|---------|----------|
| `react` | ^19.1.1 | UI framework | [VERIFIED: package.json] |
| `react-dom` | ^19.1.1 | React DOM renderer | [VERIFIED: package.json] |
| `music-metadata` | ^11.9.0 | Audio file tag parsing (ID3, Vorbis, etc.) | [VERIFIED: `electron/main.cjs:125`] |

### Dev Dependencies
[VERIFIED: `package.json:19-28`]

| Dependency | Version | Purpose |
|------------|---------|---------|
| `electron` | ^38.0.0 | Desktop shell |
| `vite` | ^7.1.3 | Build tool |
| `@vitejs/plugin-react-swc` | ^4.0.1 | React Fast Refresh via SWC |
| `typescript` | ^5.9.2 | Type checking |
| `concurrently` | ^9.2.1 | Run Vite + Electron in parallel |
| `wait-on` | ^8.0.5 | Wait for Vite dev server before Electron launch |
| `@types/node`, `@types/react`, `@types/react-dom` | Various | Type definitions |

### External Services

| Service | Integration Point | Protocol | Evidence |
|---------|-------------------|----------|----------|
| Spotify Web API | `electron/main.cjs` | HTTPS REST + PKCE OAuth 2.0 | [VERIFIED: `electron/main.cjs:9` SPOTIFY_API_BASE, `electron/main.cjs:306-425` startSpotifyAuth] |
| Spotify Accounts | `electron/main.cjs` | HTTPS (token exchange, refresh) | [VERIFIED: `electron/main.cjs:271` accounts.spotify.com/api/token] |
| Local filesystem | `electron/main.cjs` | Node.js `fs/promises` | [VERIFIED: `electron/main.cjs:3`] |

[NOT_FOUND: searched for "database", "sqlite", "sql", "store", "persist" -- no database integration]
No database. Data is ephemeral per session except `spotifyClientId` saved to `localStorage`.

[NOT_FOUND: searched for ".env", "dotenv", "process.env" references beyond Electron builtins -- no environment configuration files]
No `.env` file or environment variable configuration. Spotify Client ID is entered by the user in the UI and persisted to localStorage.

---

## 6. Known Issues & Risks

### 1. All State in Root App Component
[VERIFIED: `src/App.tsx:84-119`]
The `App` component manages 17+ pieces of `useState`, multiple refs, and all business logic callbacks. This is a monolithic state pattern that will become harder to maintain as the app grows. No state management library or context providers are used.
[INFERRED: architectural risk as feature count increases]

### 1b. Analysis Queue Deadlock (RESOLVED)
[VERIFIED: `src/App.tsx:115-118, 320-372`]
Previously, the analysis queue `useEffect` used `analyzingTrackId` (state) in its dependency array and referenced `localTracks` directly, causing the effect to self-cancel on every state update and deadlock the queue. This was fixed by introducing `analysisRunningRef` (a ref-based mutex at line 118) and `localTracksRef` (a ref mirror of `localTracks` at line 116) to remove reactive state from the dependency array. The effect now depends on `[analysisQueue, appendConsoleEntry, ensureAudioContext, publishError, readTrackBuffer]` and uses `analysisRunningRef.current` as the guard.
[RESOLVED at commit `eb2e526`]

### 2. No Error Boundaries
[NOT_FOUND: searched for "ErrorBoundary", "componentDidCatch" in `src/`]
No React error boundaries. An unhandled render error would crash the entire UI.

### 3. No Test Coverage
[NOT_FOUND: searched for "test", "spec", "vitest", "jest" configuration]
Zero test files. The DJ engine and audio analysis modules contain complex algorithms (BPM estimation, key detection, Camelot wheel, transition scoring) that are highly testable.

### 4. Sequential File Scanning
[VERIFIED: `electron/main.cjs:549-555`]
```javascript
for (const filePath of files) {
  tracks.push(await parseLocalTrack(filePath));
}
```
Audio metadata parsing is sequential. For large libraries this could be slow. Batched/parallel processing would improve scan performance.

### 5. No Persistent Storage
[INFERRED: from full codebase review]
Analysis results (BPM, key, energy, waveform) are lost when the app closes. No database, no file cache. Every session requires a full rescan and reanalysis.

### 6. Spotify Session Not Persisted
[VERIFIED: `electron/main.cjs:23`]
`spotifySession` is an in-memory variable. The user must re-authenticate Spotify every time the app restarts.

### 7. Hardcoded Ports
[VERIFIED: `electron/main.cjs:7-8`, `vite.config.ts:8`]
- Vite dev server: port 5173 (strictPort)
- Spotify callback server: port 47832

Port conflicts would prevent the app from starting or Spotify auth from completing.

### 8. Client-Side Analysis Accuracy
[INFERRED: from algorithm review in `src/lib/audioAnalysis.ts`]
The BPM estimation uses onset-envelope autocorrelation at a downsampled 11025 Hz rate with octave-doubling/halving heuristics. Key detection uses Goertzel power + Krumhansl-Schmuckler profiles. These are reasonable lightweight algorithms but will be less accurate than dedicated tools (e.g., Essentia, librosa) for complex material.

---

## 7. Entry Points Summary

| Entry | Method | Handler | Verified |
|-------|--------|---------|----------|
| App launch | Electron `app.whenReady()` | `createWindow()` | [VERIFIED] |
| React mount | `createRoot().render(<App />)` | `src/main.tsx` | [VERIFIED] |
| Scan music folder | Button click -> IPC | `library:select-folder` + `library:scan-folder` | [VERIFIED] |
| Analyze all tracks | Button click | `handleAnalyzeAll()` in App | [VERIFIED] |
| Analysis queue processor | `useEffect` on `analysisQueue` with ref-based mutex (`analysisRunningRef`) | Reads buffer via IPC, runs `analyzeAudioFile`; uses `localTracksRef` to avoid stale closure | [VERIFIED: `src/App.tsx:320-372`] |
| Load track to deck | Table button / suggestion button | `handleLoadTrack(deckId, trackId)` | [VERIFIED] |
| Play/Pause | Transport button | `DeckPanel.handleTogglePlayback()` -> HTMLAudioElement | [VERIFIED] |
| Sync deck | Transport button | `handleSyncDeck(deckId)` -> adjusts playbackRate | [VERIFIED] |
| Set cue point | Transport button | `handleAddCue(deckId, time)` | [VERIFIED] |
| Spotify connect | Button click -> IPC | `spotify:login` -> PKCE OAuth | [VERIFIED] |
| Spotify sync | Button click -> IPC | `spotify:sync` -> paginated API import | [VERIFIED] |
| Spotify disconnect | Button click -> IPC | `spotify:logout` -> session clear | [VERIFIED] |
| Search library | Text input | `deferredSearch` -> `getVisibleTracks()` | [VERIFIED] |
| Sort/Filter library | Select dropdowns | `sortKey`/`sourceFilter` -> `getVisibleTracks()` | [VERIFIED] |
| Select crate | Sidebar crate button | `setSelectedCrateId` -> `getVisibleTracks()` | [VERIFIED] |

---

## 8. Technology Stack Summary

| Layer | Technology | Evidence |
|-------|------------|---------|
| Desktop Shell | Electron 38 | [VERIFIED: `package.json:25`] |
| UI Framework | React 19 | [VERIFIED: `package.json:16`] |
| Language | TypeScript 5.9 (strict) | [VERIFIED: `tsconfig.json:10`] |
| Build Tool | Vite 7 + SWC | [VERIFIED: `package.json:27`, `vite.config.ts`] |
| Styling | Single global CSS file — "Forest Night" theme (`#080e08` bg, `#7aff8a`/`#d4e157` accents, `#e0f0e4` text, 20px radius, 16px blur), IBM Plex Sans body font, CSS custom properties | [VERIFIED: `src/styles.css:1-22`] |
| Audio Metadata | music-metadata 11 | [VERIFIED: `package.json:15`] |
| Audio Analysis | Web Audio API (client-side BPM, key, energy, waveform) | [VERIFIED: `src/lib/audioAnalysis.ts`] |
| Audio Playback | HTML5 `<audio>` element via Blob URLs | [VERIFIED: `src/components/DeckPanel.tsx:330`] |
| External API | Spotify Web API (PKCE OAuth 2.0) | [VERIFIED: `electron/main.cjs:9`] |
| IPC Bridge | Electron contextBridge + ipcMain/ipcRenderer | [VERIFIED: `electron/preload.cjs`] |
| State Management | React useState/useRef/useMemo (no external library) | [VERIFIED: `src/App.tsx`] |
| Data Persistence | localStorage (Spotify Client ID only) | [VERIFIED: `src/App.tsx:88, 198`] |

---

## What This System Does NOT Have

Based on searches finding no results:

1. **No Backend Server** -- Electron main process handles all "server" duties [NOT_FOUND: no Express, Fastify, or HTTP server beyond Spotify callback]
2. **No Database** -- No SQLite, IndexedDB wrapper, or persistent storage [NOT_FOUND]
3. **No Authentication** -- Beyond Spotify OAuth, no user auth system [NOT_FOUND]
4. **No Tests** -- No test framework or test files [NOT_FOUND]
5. **No CI/CD** -- No GitHub Actions, pipeline configs [NOT_FOUND]
6. **No Client-Side Routing** -- Single-view SPA [NOT_FOUND]
7. **No State Management Library** -- No Redux, Zustand, Jotai, or Context providers [NOT_FOUND]
8. **No CSS Framework** -- Custom CSS with variables, no Tailwind/Styled Components [NOT_FOUND]

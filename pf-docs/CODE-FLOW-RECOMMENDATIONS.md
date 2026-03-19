# Code Flow Recommendations: Peak DJ Command

> Generated: 2026-03-18
> Based on: `pf-docs/01-architecture-overview.md` (commit a2a55a2)

## Summary

| Flow | Priority | Components | Effort |
|------|----------|------------|--------|
| Analysis Pipeline | High (12) | 6 | Medium |
| Library Merge & Smart Crates | High (11) | 3 | Medium |
| Folder Scan → Playable Library | Medium (9) | 4 | Low |
| Spotify PKCE Auth Flow | Medium (8) | 3 | Medium |

---

## Recommended Flows

### 1. Analysis Pipeline (Priority: High — 12/12)

**Why document this?**
The analysis queue is the most complex async flow in the app. It spans IPC (file read), Web Audio API (decode + DSP), and React state updates. The recent deadlock bug (effect self-cancellation via dependency array) proves this flow is fragile and needs to be understood end-to-end.

| Criterion | Score | Reason |
|-----------|-------|--------|
| Frequency | 3 | Runs for every playable track, auto-queued on scan |
| Complexity | 3 | IPC → ArrayBuffer → AudioContext → DSP → state update, ref-based guard |
| Mystery | 3 | BPM estimation (onset autocorrelation), key detection (Goertzel + Krumhansl), queue scheduling |
| Debug value | 3 | Recent deadlock bug; silent failures possible if decode/analysis throws |

**Trigger**: `handleAnalyzeAll()` button click, or auto-queue after `handleScanFolder()` at `App.tsx:462-463`

**Key components**:
- `App.tsx` — analysis queue state, `analysisRunningRef` guard, `useEffect` processor
- `electron/main.cjs` — `library:read-audio-file` IPC handler (raw file bytes)
- `electron/preload.cjs` — `readAudioFile` bridge method
- `src/lib/audioAnalysis.ts` — `analyzeAudioFile`: decode → mixdown → downsample → BPM/key/energy/waveform
- `src/lib/djEngine.ts` — `needsAnalysis()` gate, `normalizeMusicalKey()`, `camelotFromKey()`
- `src/components/Waveform.tsx` — consumes `track.waveform` data for visualization

**Key files to start tracing**:
- `src/App.tsx:479-488` — `handleAnalyzeAll` queues track IDs
- `src/App.tsx:317-389` — analysis queue `useEffect` (the fixed version with `analysisRunningRef`)
- `src/App.tsx:242-256` — `readTrackBuffer` IPC call and cache
- `src/lib/audioAnalysis.ts:292-313` — `analyzeAudioFile` entry point
- `src/lib/audioAnalysis.ts:117-172` — BPM estimation algorithm
- `src/lib/audioAnalysis.ts:220-290` — key estimation algorithm

**Prompt to use**:
```
Create code flow documentation for Peak DJ covering:
Analysis Pipeline - from "Analyze All" click through IPC file read, AudioContext
decode, BPM/key/energy/waveform estimation, back to React state update and
queue advancement.

Reference the architecture overview at pf-docs/01-architecture-overview.md
Start tracing from src/App.tsx:479 (handleAnalyzeAll)
Follow through the useEffect at src/App.tsx:317 and into src/lib/audioAnalysis.ts:292
```

---

### 2. Library Merge & Smart Crates (Priority: High — 11/12)

**Why document this?**
The merge algorithm is the core "intelligence" of the app — it unifies two completely different data sources (local files + Spotify metadata) into one browsable library using ISRC and fingerprint matching, then generates smart AI-style crates (Warm Up, Peak Pressure, Harmonic Ladder, Reset Lane). This logic is opaque and non-trivial.

| Criterion | Score | Reason |
|-----------|-------|--------|
| Frequency | 3 | Runs on every scan and every Spotify sync |
| Complexity | 3 | ISRC matching, normalized fingerprints, smart crate generation with energy/key filters |
| Mystery | 3 | Matching heuristics, crate classification logic, what "Harmonic Ladder" actually means |
| Debug value | 2 | Mismatches would show wrong data; but errors are unlikely to be silent |

**Trigger**: Any change to `localTracks`, `spotifyTracks`, or `spotifyPlaylists` state (via `useMemo` at `App.tsx:120-121`)

**Key components**:
- `src/lib/djEngine.ts` — `mergeTrackLibraries()` (200+ lines), crate generation logic
- `src/App.tsx` — `useMemo` consuming merged `tracks` + `crates`
- `src/types.ts` — `Track`, `Crate`, `CrateKind`, `CrateSource` interfaces

**Key files to start tracing**:
- `src/lib/djEngine.ts:198` — `mergeTrackLibraries` entry
- `src/lib/djEngine.ts:65-78` — `normalizeText`, `makeFingerprint` (matching helpers)
- `src/lib/djEngine.ts:83-112` — Camelot adjacency logic (used by smart crates)
- `src/lib/djEngine.ts:405` — `getVisibleTracks` (filtering/sorting the merged library)

**Prompt to use**:
```
Create code flow documentation for Peak DJ covering:
Library Merge & Smart Crates - how local and Spotify tracks are unified via ISRC
and fingerprint matching, how smart crates (Warm Up, Peak Pressure, Harmonic Ladder,
Reset Lane) are generated from energy/key analysis.

Reference the architecture overview at pf-docs/01-architecture-overview.md
Start tracing from src/lib/djEngine.ts:198 (mergeTrackLibraries)
```

---

### 3. Folder Scan → Playable Library (Priority: Medium — 9/12)

**Why document this?**
The primary onboarding flow — a user's first action is scanning a music folder. It crosses the IPC boundary twice (folder picker + scan) and involves metadata parsing with fallback handling.

| Criterion | Score | Reason |
|-----------|-------|--------|
| Frequency | 3 | First thing every user does |
| Complexity | 2 | Sequential IPC calls, metadata parse with fallback, state reset |
| Mystery | 2 | music-metadata parsing is a library call; not deeply custom |
| Debug value | 2 | Scan errors surface in console; file format issues are common |

**Trigger**: "Scan Music Folder" button click → `handleScanFolder()` at `App.tsx:440`

**Key components**:
- `src/App.tsx` — `handleScanFolder` orchestrator
- `electron/main.cjs` — `library:select-folder` (dialog), `library:scan-folder` (walk + parse)
- `electron/main.cjs` — `walkMusicFiles`, `parseLocalTrack`, `music-metadata`
- `electron/preload.cjs` — bridge methods

**Key files to start tracing**:
- `src/App.tsx:440-477` — `handleScanFolder`
- `electron/main.cjs:530-556` — IPC handlers for select + scan
- `electron/main.cjs:95-122` — `walkMusicFiles` recursive directory walker
- `electron/main.cjs:124-200` — `parseLocalTrack` metadata extraction

**Prompt to use**:
```
Create code flow documentation for Peak DJ covering:
Folder Scan - from button click through native dialog, recursive file walk,
metadata extraction via music-metadata, to React state population and
auto-queue of analysis.

Reference the architecture overview at pf-docs/01-architecture-overview.md
Start tracing from src/App.tsx:440 (handleScanFolder)
```

---

### 4. Spotify PKCE Auth Flow (Priority: Medium — 8/12)

**Why document this?**
The OAuth implementation is the most "infrastructure-like" code in the app. It spins up a local HTTP server, handles PKCE code exchange, manages token refresh, and has rate-limit retry logic. Understanding this is essential for debugging Spotify connection issues.

| Criterion | Score | Reason |
|-----------|-------|--------|
| Frequency | 1 | Once per session |
| Complexity | 3 | PKCE verifier/challenge, local HTTP callback server, token exchange, refresh loop |
| Mystery | 2 | OAuth PKCE is a standard flow, but the local server + Electron integration is custom |
| Debug value | 2 | Auth failures are common (wrong redirect URI, expired tokens) |

**Trigger**: "Connect" button → `handleSpotifyConnect()` at `App.tsx:490`

**Key components**:
- `src/App.tsx` — `handleSpotifyConnect`, `handleSpotifySync`, `handleSpotifyLogout`
- `electron/main.cjs` — `startSpotifyAuth`, `spotifyFetch`, `spotifyPaginated`, `refreshSpotifyAccessToken`, `ensureSpotifyAccessToken`, `importSpotifyLibrary`

**Key files to start tracing**:
- `src/App.tsx:490-508` — `handleSpotifyConnect`
- `electron/main.cjs:306-425` — `startSpotifyAuth` (PKCE + local HTTP server)
- `electron/main.cjs:209-295` — `spotifyFetch`, `spotifyPaginated`, token refresh

**Prompt to use**:
```
Create code flow documentation for Peak DJ covering:
Spotify PKCE Auth - from Connect button through code verifier generation,
browser redirect, local HTTP callback server, token exchange, and library import.

Reference the architecture overview at pf-docs/01-architecture-overview.md
Start tracing from electron/main.cjs:306 (startSpotifyAuth)
```

---

## Skip These (Low Value)

| Flow | Why Skip |
|------|----------|
| Deck load + playback | Simple: lookup track → IPC read → blob URL → `<audio>.src`. Only 3 steps, linear. |
| Search/sort/filter library | Pure synchronous function (`getVisibleTracks`) with standard array operations. |
| Cue point management | Trivial state append + sort on DeckState.cuePoints array. |
| Transition scoring | Worth documenting algorithm but it's a single pure function, not a "flow". Better as API docs. |

---

## Notes

- **Recommended order**: Flow 1 (Analysis) first — it's the most bug-prone and crosses the most boundaries. Flow 2 (Merge) second — it's the core differentiator. Flows 3-4 can be done in either order.
- **Dependency**: Flow 1 depends on Flow 3 (scan provides the tracks to analyze). Consider documenting them as a combined "Scan → Analyze" super-flow if doing a walkthrough.
- The architecture overview notes this app has **no tests**. These flow docs double as a test plan — each step is a testable assertion.

# Analysis Pipeline Code Flow

## Metadata
| Field | Value |
|-------|-------|
| Repository | `peak-codex-dac` |
| Commit | `a2a55a2` |
| Documented | `2026-03-18` |
| Trigger | "Analyze All" button click, or auto-queue after folder scan |
| End State | Track objects updated with `bpm`, `key`, `camelotKey`, `energy`, `waveform`, `analysisSource: 'local-analysis'` |

## Verification Summary
- [VERIFIED]: 18 steps
- [INFERRED]: 2 (AudioContext sample rate, confidence heuristic tuning)
- [NOT_FOUND]: 0

---

## Flow Diagram

```
[User clicks "Analyze All"]                 [Folder scan completes]
           │                                         │
           ▼                                         ▼
  handleAnalyzeAll()                    handleScanFolder() auto-queues
           │                                         │
           ├──→ needsAnalysis() filter               │
           │                                         │
           ▼                                         ▼
  queueTracksForAnalysis(ids, prioritize=true)
           │
           ▼
  setAnalysisQueue(...)  ⚡ triggers useEffect
           │
           ▼
  ┌─────────────────────────────────────────────┐
  │  Analysis Queue Effect (useEffect)          │
  │                                             │
  │  Guard: analysisRunningRef.current?         │
  │         analysisQueue.length === 0?         │
  │              │                              │
  │              ▼                              │
  │  Lookup track via localTracksRef            │
  │              │                              │
  │              ▼                              │
  │  analysisRunningRef.current = true          │
  │  setAnalyzingTrackId(nextTrackId)           │
  │              │                              │
  │              ▼                              │
  │  ┌───── async IIFE ─────────────────┐      │
  │  │                                   │      │
  │  │  ~~> readTrackBuffer(track)       │      │
  │  │       │                           │      │
  │  │       ├──→ cache hit? return      │      │
  │  │       │                           │      │
  │  │       ├──→ IPC: readAudioFile     │      │
  │  │       │    (Electron main process)│      │
  │  │       │         │                 │      │
  │  │       │         ▼                 │      │
  │  │       │    fs.readFile(filePath)   │      │
  │  │       │         │                 │      │
  │  │       │         ▼                 │      │
  │  │       │    return Uint8Array      │      │
  │  │       │                           │      │
  │  │       ├──→ bytesToArrayBuffer()   │      │
  │  │       ├──→ cache ArrayBuffer      │      │
  │  │       │                           │      │
  │  │  ~~> ensureAudioContext()         │      │
  │  │       │                           │      │
  │  │  ~~> analyzeAudioFile(buf, ctx)   │      │
  │  │       │                           │      │
  │  │       ├──→ decodeAudioData()      │      │
  │  │       ├──→ mixdown() → mono       │      │
  │  │       ├──→ downsample() → 11025Hz │      │
  │  │       │                           │      │
  │  │       ├──→ estimateBpm()          │      │
  │  │       │    onset envelope +       │      │
  │  │       │    autocorrelation        │      │
  │  │       │    70-180 BPM range       │      │
  │  │       │                           │      │
  │  │       ├──→ estimateKey()          │      │
  │  │       │    Goertzel bins (3 oct)  │      │
  │  │       │    Krumhansl profiles     │      │
  │  │       │    → key + Camelot code   │      │
  │  │       │                           │      │
  │  │       ├──→ estimateEnergy()       │      │
  │  │       │    RMS * 240, clamped 0-100│     │
  │  │       │                           │      │
  │  │       ├──→ buildWaveform(180)     │      │
  │  │       │                           │      │
  │  │       ▼                           │      │
  │  │  return TrackAnalysis             │      │
  │  │       │                           │      │
  │  │  ──→ setLocalTracks(merge)        │      │
  │  │       │                           │      │
  │  │  finally:                         │      │
  │  │    analysisRunningRef = false     │      │
  │  │    setAnalyzingTrackId(null)      │      │
  │  │    remove from analysisQueue     │      │
  │  │    ⚡ queue change re-triggers    │      │
  │  │       effect for next track      │      │
  │  └───────────────────────────────────┘      │
  └─────────────────────────────────────────────┘
```

---

## Detailed Flow

### Step 1: Entry — handleAnalyzeAll()
[VERIFIED: src/App.tsx:462-471]
```typescript
const handleAnalyzeAll = () => {
    const analyzableIds = localTracks.filter((track) => needsAnalysis(track)).map((track) => track.id);
    if (analyzableIds.length === 0) {
      publishNotice('All playable local tracks already have analysis data.', 'success');
      return;
    }

    queueTracksForAnalysis(analyzableIds, true);
    publishNotice(`Queued ${analyzableIds.length} local tracks for BPM, key, energy, and waveform analysis.`);
  };
```

**Data in:** `localTracks: Track[]` (current state)
**Calls:** `needsAnalysis()` → `queueTracksForAnalysis()`
**Data out:** Array of track IDs that need analysis

**Alternative trigger — auto-queue after scan:**
[VERIFIED: src/App.tsx:445-446]
```typescript
const queuedIds = scannedTracks.filter((track) => needsAnalysis(track)).map((track) => track.id);
queueTracksForAnalysis(queuedIds, true);
```

---

### Step 2: needsAnalysis() gate
[VERIFIED: src/lib/djEngine.ts:191-196]
```typescript
export function needsAnalysis(track: Track) {
  return (
    track.availability === 'playable' &&
    (track.energy === null || track.waveform.length === 0 || track.bpm === null || track.camelotKey === null)
  );
}
```

A track needs analysis if it is `playable` AND any of: `energy` is null, `waveform` is empty, `bpm` is null, or `camelotKey` is null. Since the scanner sets `energy: null`, `waveform: []`, and `camelotKey: null` for every local track, all freshly scanned tracks pass this gate.

**Data in:** `Track` object
**Data out:** `boolean`

---

### Step 3: queueTracksForAnalysis()
[VERIFIED: src/App.tsx:280-290]
```typescript
const queueTracksForAnalysis = useCallback((trackIds: string[], prioritize = false) => {
    if (trackIds.length === 0) {
      return;
    }

    setAnalysisQueue((current) => {
      const existing = new Set(current);
      const incoming = trackIds.filter((trackId) => !existing.has(trackId));
      return prioritize ? [...incoming, ...current] : [...current, ...incoming];
    });
  }, []);
```

Deduplicates incoming IDs against the existing queue. When `prioritize=true` (both triggers use this), new IDs are prepended to the front of the queue.

**Data in:** `trackIds: string[]`, `prioritize: boolean`
**Data out:** Updated `analysisQueue` state (triggers re-render → effect)

---

### Step 4: Analysis Queue Effect — Guard & Lookup
[VERIFIED: src/App.tsx:320-330]
```typescript
useEffect(() => {
    if (analysisRunningRef.current || analysisQueue.length === 0) {
      return;
    }

    const nextTrackId = analysisQueue[0];
    const track = localTracksRef.current.find((item) => item.id === nextTrackId);
    if (!track || !track.filePath) {
      setAnalysisQueue((current) => current.filter((id) => id !== nextTrackId));
      return;
    }
```

**Guard logic:**
- `analysisRunningRef.current` — ref-based mutex. Prevents the effect from launching concurrent analyses when deps change during an in-flight analysis. This was the fix for the original deadlock bug where `analyzingTrackId` (a state variable) in the dep array would re-trigger and cancel the effect.
- `analysisQueue.length === 0` — nothing to do.

**Track lookup:** Uses `localTracksRef.current` (a ref synced on every render) instead of `localTracks` directly, to avoid including `localTracks` in the dependency array.

**Data in:** `analysisQueue[0]` (next track ID)
**Data out:** `Track` object with `filePath`

---

### Step 5: Set Running State
[VERIFIED: src/App.tsx:332-334]
```typescript
    analysisRunningRef.current = true;
    setAnalyzingTrackId(nextTrackId);
    appendConsoleEntry('info', `Analyzing ${track.title} for BPM, key, waveform, and energy.`);
```

Sets the ref-based mutex, updates UI state for progress display, and logs to the console feed.

---

### Step 6: IPC — Read Audio File Bytes
[VERIFIED: src/App.tsx:245-259]
```typescript
const readTrackBuffer = useCallback(async (track: Track) => {
    if (!track.filePath) {
      throw new Error('This track has no local audio file.');
    }

    const cached = bufferCacheRef.current.get(track.filePath);
    if (cached) {
      return cached;
    }

    const bytes = await window.appAPI.readAudioFile(track.filePath);
    const arrayBuffer = bytesToArrayBuffer(bytes);
    bufferCacheRef.current.set(track.filePath, arrayBuffer);
    return arrayBuffer;
  }, []);
```

**Cache:** `bufferCacheRef` is a `Map<string, ArrayBuffer>`. If the file was already read (e.g., loaded onto a deck), the cached buffer is returned immediately.

**IPC bridge:**
[VERIFIED: electron/preload.cjs:6]
```javascript
readAudioFile: (filePath) => ipcRenderer.invoke('library:read-audio-file', filePath),
```

**Main process handler:**
[VERIFIED: electron/main.cjs:558-561]
```javascript
ipcMain.handle('library:read-audio-file', async (_event, filePath) => {
  const file = await fs.readFile(filePath);
  return new Uint8Array(file);
});
```

Reads the entire file into memory and returns raw bytes as `Uint8Array`. Electron's IPC serializes this across process boundaries.

**ArrayBuffer conversion:**
[VERIFIED: src/App.tsx:69-73]
```typescript
function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
```

Copies into a fresh `ArrayBuffer` because Electron IPC may return a `SharedArrayBuffer` which is not accepted by `decodeAudioData`.

**Data in:** `track.filePath: string` (e.g., `/Volumes/T9/.../song.mp3`)
**Data out:** `ArrayBuffer` (raw audio file bytes)

---

### Step 7: Ensure AudioContext
[VERIFIED: src/App.tsx:236-243]
```typescript
const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const ContextCtor = window.AudioContext;
      audioContextRef.current = new ContextCtor();
    }

    return audioContextRef.current;
  }, []);
```

Lazily creates a single `AudioContext` for the lifetime of the app. The context is created on first analysis (not on mount) to avoid browser autoplay-policy warnings.

[INFERRED: AudioContext uses the system default sample rate, typically 44100 Hz or 48000 Hz on macOS]

---

### Step 8: analyzeAudioFile() — Decode & Prepare
[VERIFIED: src/lib/audioAnalysis.ts:292-298]
```typescript
export async function analyzeAudioFile(
  arrayBuffer: ArrayBuffer,
  audioContext: AudioContext
): Promise<TrackAnalysis> {
  const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  const mono = mixdown(decoded);
  const resampled = downsample(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
```

**8a. Decode:** `decodeAudioData` is the Web Audio API call that decodes MP3/M4A/WAV/FLAC/etc. into raw PCM. The `.slice(0)` creates a copy because `decodeAudioData` detaches the ArrayBuffer.

**8b. Mixdown:**
[VERIFIED: src/lib/audioAnalysis.ts:15-27]
```typescript
function mixdown(buffer: AudioBuffer) {
  const channelCount = buffer.numberOfChannels;
  const output = new Float32Array(buffer.length);
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = buffer.getChannelData(channelIndex);
    for (let index = 0; index < channelData.length; index += 1) {
      output[index] += channelData[index] / channelCount;
    }
  }
  return output;
}
```

Averages all channels into mono. A stereo track divides each sample by 2 and sums.

**8c. Downsample:**
[VERIFIED: src/lib/audioAnalysis.ts:29-56]
```typescript
function downsample(samples: Float32Array, inputRate: number, outputRate: number) {
  if (outputRate >= inputRate) {
    return samples;
  }
  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(samples.length / ratio);
  const output = new Float32Array(outputLength);
  // ... averaging buckets
}
```

Reduces from source sample rate (typically 44100 Hz) down to `TARGET_SAMPLE_RATE = 11025` Hz. This 4x reduction speeds up BPM/key analysis significantly.

**Data in:** `ArrayBuffer` (encoded audio)
**Data out:** `Float32Array` (mono, 11025 Hz PCM samples)

---

### Step 9: BPM Estimation
[VERIFIED: src/lib/audioAnalysis.ts:58-67, 117-172]

**9a. Window selection:**
```typescript
const bpmWindow = selectWindow(resampled, TARGET_SAMPLE_RATE, BPM_WINDOW_SECONDS, 0.18);
```
Selects a 90-second window anchored at 18% of the track (to avoid intros). If the track is shorter than 90s, uses the full track.

**9b. Onset envelope:**
[VERIFIED: src/lib/audioAnalysis.ts:117-133]
```typescript
function estimateBpm(samples: Float32Array, sampleRate: number) {
  const frameSize = 1024;
  const hopSize = 256;
  const onsetEnvelope: number[] = [];
  let previousRms = 0;

  for (let start = 0; start + frameSize < samples.length; start += hopSize) {
    let energy = 0;
    for (let index = 0; index < frameSize; index += 1) {
      const value = samples[start + index];
      energy += value * value;
    }
    const rms = Math.sqrt(energy / frameSize);
    onsetEnvelope.push(Math.max(0, rms - previousRms));
    previousRms = rms;
  }
```

Computes RMS energy per frame (1024 samples, hop 256). The onset envelope captures *increases* in energy — the positive derivative of RMS. This detects beats.

**9c. Autocorrelation:**
[VERIFIED: src/lib/audioAnalysis.ts:135-156]
```typescript
  const smoothed = smooth(onsetEnvelope, 3);
  const fps = sampleRate / hopSize;
  const minLag = Math.round((60 * fps) / 180);  // 180 BPM ceiling
  const maxLag = Math.round((60 * fps) / 70);   // 70 BPM floor

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let index = lag; index < smoothed.length; index += 1) {
      score += smoothed[index] * smoothed[index - lag];
    }
    // track best and second-best scores
  }
```

Scans lag values corresponding to 70-180 BPM. For each lag, computes the dot product of the onset envelope with itself shifted by that lag. The best-scoring lag corresponds to the dominant periodicity (tempo).

**9d. Octave correction:**
[VERIFIED: src/lib/audioAnalysis.ts:158-166]
```typescript
  let bpm = (60 * fps) / bestLag;
  if (bpm < 84) { bpm *= 2; }
  if (bpm > 170) { bpm /= 2; }
```

Doubles sub-84 BPM (likely half-time detection) and halves super-170 BPM (likely double-time).

**9e. Confidence:**
[VERIFIED: src/lib/audioAnalysis.ts:170]
```typescript
  confidence: clamp(bestScore > 0 ? (bestScore - secondScore) / bestScore + 0.35 : 0, 0, 1)
```

Confidence is the margin between the best and second-best lag scores, biased up by 0.35.

**Data in:** `Float32Array` (mono 11025 Hz, 90s window)
**Data out:** `{ bpm: number, confidence: number }`

---

### Step 10: Key Estimation
[VERIFIED: src/lib/audioAnalysis.ts:220-290]

**10a. Window selection:**
```typescript
const workingSamples = selectWindow(samples, sampleRate, KEY_WINDOW_SECONDS, 0.24);
```
Uses a 72-second window anchored at 24% of the track.

**10b. Chroma accumulation via Goertzel:**
[VERIFIED: src/lib/audioAnalysis.ts:222-246]
```typescript
  const windowSize = 4096;
  const hopSize = 4096;
  const chroma = new Array(12).fill(0);
  const octaves = [48, 60, 72]; // MIDI octaves 3, 4, 5

  for (let start = 0; start + windowSize < workingSamples.length; start += hopSize) {
    // skip silent frames (rms < 0.02)
    for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
      let power = 0;
      for (const octave of octaves) {
        power += goertzelPower(workingSamples, start, windowSize, sampleRate,
                               midiToFrequency(octave + pitchClass));
      }
      chroma[pitchClass] += power;
    }
  }
```

For each 4096-sample frame, uses the Goertzel algorithm (single-frequency DFT) to measure power at each of 12 pitch classes across 3 octaves. Accumulates into a 12-element chroma vector.

**10c. Key profile correlation (Krumhansl-Schmuckler):**
[VERIFIED: src/lib/audioAnalysis.ts:248-282]
```typescript
  const normalizedChroma = normalizeVector(chroma);
  for (let root = 0; root < 12; root += 1) {
    const majorScore = correlation(normalizedChroma, rotateProfile(MAJOR_PROFILE, root));
    const minorScore = correlation(normalizedChroma, rotateProfile(MINOR_PROFILE, root));
    // track best score, root, and mode
  }
```

Correlates the observed chroma with Krumhansl-Kessler major and minor key profiles for all 12 root notes (24 comparisons total). The highest correlation determines the key.

**10d. Output normalization:**
[VERIFIED: src/lib/audioAnalysis.ts:284-289]
```typescript
  const key = normalizeMusicalKey(`${NOTE_NAMES[bestRoot]}${bestMode === 'minor' ? 'm' : ''}`);
  return {
    key,
    camelot: camelotFromKey(key),
    confidence: clamp((bestScore - secondScore) / Math.max(bestScore, 0.001) + 0.32, 0, 1)
  };
```

Normalizes the detected key string through `djEngine.normalizeMusicalKey()` (handles enharmonic equivalents like Db↔C#) and maps to a Camelot wheel code via `camelotFromKey()`.

**Data in:** `Float32Array` (mono 11025 Hz, 72s window)
**Data out:** `{ key: string | null, camelot: string | null, confidence: number }`

---

### Step 11: Energy & Waveform
[VERIFIED: src/lib/audioAnalysis.ts:89-98, 70-87, 309-310]
```typescript
  energy: estimateEnergy(resampled),
  waveform: buildWaveform(resampled, 180),
```

**Energy:**
```typescript
function estimateEnergy(samples: Float32Array) {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    sum += value * value;
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.round(clamp(rms * 240, 0, 100));
}
```
Global RMS of the full track, scaled by 240 and clamped to 0-100. A quiet ambient track might score 15; a loud EDM track scores 80+.

**Waveform:**
```typescript
function buildWaveform(samples: Float32Array, bucketCount: number) {
  const buckets = new Array(bucketCount).fill(0);
  const bucketSize = Math.max(1, Math.floor(samples.length / bucketCount));
  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    // find peak amplitude in each bucket
    buckets[bucketIndex] = Number(clamp(peak, 0, 1).toFixed(3));
  }
  return buckets;
}
```
Divides the track into 180 equal segments and records the peak amplitude in each. These 180 values drive the Waveform SVG visualization.

**Data in:** `Float32Array` (full mono 11025 Hz)
**Data out:** `energy: number (0-100)`, `waveform: number[] (180 peaks, 0-1)`

---

### Step 12: State Update — Merge Analysis Results
[VERIFIED: src/App.tsx:342-362]
```typescript
        setLocalTracks((current) =>
          current.map((item) => {
            if (item.id !== nextTrackId) {
              return item;
            }

            const nextKey = normalizeMusicalKey(item.key || analysis.key);

            return {
              ...item,
              bpm: item.bpm ?? analysis.bpm,
              bpmConfidence: Math.max(item.bpmConfidence, analysis.bpmConfidence),
              key: nextKey,
              camelotKey: item.camelotKey || analysis.camelotKey || camelotFromKey(nextKey),
              keyConfidence: Math.max(item.keyConfidence, analysis.keyConfidence),
              energy: analysis.energy,
              waveform: analysis.waveform,
              analysisSource: 'local-analysis'
            };
          })
        );
```

**Merge strategy:**
- `bpm`: Uses existing tag BPM if available (`??`), otherwise analysis BPM
- `bpmConfidence`: Takes the higher confidence between tag and analysis
- `key`: Prefers existing tag key over analysis key (`||`)
- `camelotKey`: Falls back through: existing → analysis → derived from key
- `energy`: Always overwrites with analysis value (tags don't provide energy)
- `waveform`: Always overwrites (tags don't provide waveform)
- `analysisSource`: Set to `'local-analysis'`

**Data in:** `TrackAnalysis` + existing `Track`
**Data out:** Updated `Track` object in `localTracks` state

---

### Step 13: Queue Advancement
[VERIFIED: src/App.tsx:366-372]
```typescript
      } finally {
        analysisRunningRef.current = false;
        setAnalyzingTrackId(null);
        setAnalysisQueue((current) => current.filter((id) => id !== nextTrackId));
      }
```

The `finally` block **always runs** (no `cancelled` check — that was the original bug). It:
1. Clears the ref-based mutex
2. Clears the UI analyzing indicator
3. Removes the completed track from the queue

Removing from the queue triggers a React re-render, which re-runs the `useEffect` (since `analysisQueue` is in deps). If more tracks remain, Step 4 begins again for the next track.

---

### Step 14: Completion Detection
[VERIFIED: src/App.tsx:218-234]
```typescript
  useEffect(() => {
    const analysisActive = Boolean(analyzingTrackId || analysisQueue.length > 0);

    if (analysisActive) {
      analysisWasActiveRef.current = true;
      return;
    }

    if (analysisWasActiveRef.current && analysisTotalCount > 0) {
      publishNotice(
        `Analysis idle. ${analysisCompletedCount}/${analysisTotalCount} playable local tracks are now analyzed.`,
        'success'
      );
    }

    analysisWasActiveRef.current = false;
  }, [analyzingTrackId, analysisQueue.length, analysisCompletedCount, analysisTotalCount, publishNotice]);
```

A separate effect watches for the transition from "active" to "idle". When the queue empties and no track is being analyzed, it fires a completion notice to the console and banner.

---

## External Calls

| Call | Source | Target | Protocol |
|------|--------|--------|----------|
| `readAudioFile` | Renderer (App.tsx:255) | Main process (main.cjs:558) | Electron IPC (`ipcRenderer.invoke`) |
| `fs.readFile` | Main process (main.cjs:559) | Local filesystem | Node.js fs/promises |

No network calls. Analysis is entirely local.

---

## Data Shape at Key Boundaries

### IPC boundary (renderer → main → renderer)
```
Request:  filePath: string (e.g., "/Volumes/T9/.../song.mp3")
Response: Uint8Array (raw file bytes, entire file in memory)
```

### Analysis input/output
```
Input:  ArrayBuffer (raw encoded audio)
Output: {
  bpm: number | null,        // e.g., 128.0
  bpmConfidence: number,     // 0-1
  key: string | null,        // e.g., "Cm"
  camelotKey: string | null, // e.g., "5A"
  keyConfidence: number,     // 0-1
  energy: number | null,     // 0-100
  waveform: number[],        // 180 values, 0-1
  analysisSource: 'local-analysis'
}
```

### State merge (before → after)
```
Before: { bpm: null, key: "Am" (from tags), camelotKey: null, energy: null, waveform: [], analysisSource: 'tags' }
After:  { bpm: 126.3, key: "Am", camelotKey: "8A", energy: 72, waveform: [0.12, 0.34, ...180 values], analysisSource: 'local-analysis' }
```

---

## Known Issues Found

### 1. Entire File Read Into Memory
[VERIFIED: electron/main.cjs:559]
`fs.readFile(filePath)` reads the complete audio file into a Node.js Buffer, converts to `Uint8Array`, serializes across IPC, then copies to `ArrayBuffer` in the renderer. A 50 MB FLAC file creates ~150 MB of transient memory pressure (Buffer + Uint8Array + ArrayBuffer).

### 2. No Analysis Cancellation
The `finally` block always runs — there is no way to cancel an in-flight analysis (e.g., if the user scans a new folder while analysis is running). The old `cancelled` flag was removed because it caused the deadlock. A new cancellation mechanism (e.g., `AbortController`) could be added but is not currently implemented.

### 3. Sequential Processing
Tracks are analyzed one at a time. The queue effect processes `analysisQueue[0]`, completes, removes it, then processes the next. For 100+ tracks this is slow. Parallel analysis (2-3 concurrent) would improve throughput but requires managing multiple AudioContext decode operations.

### 4. Analysis Results Not Persisted
[INFERRED: from full codebase review]
All analysis data lives in React state (`localTracks`). Closing the app loses all BPM, key, energy, and waveform data. Re-scanning the same folder requires full re-analysis.

### 5. Confidence Heuristic Tuning
[INFERRED: src/lib/audioAnalysis.ts:170, 288]
Both BPM and key confidence add fixed bias values (+0.35 and +0.32 respectively). These are hand-tuned constants that inflate confidence scores. A track with ambiguous tempo may report 0.6 confidence when the actual algorithm certainty is low.

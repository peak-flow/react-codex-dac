import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { analyzeAudioFile } from './lib/audioAnalysis';
import {
  buildMixNarrative,
  buildSetArcSummary,
  camelotFromKey,
  getTransitionSuggestions,
  getVisibleTracks,
  mergeTrackLibraries,
  needsAnalysis,
  normalizeMusicalKey
} from './lib/djEngine';
import { DeckPanel } from './components/DeckPanel';
import { InsightPanel } from './components/InsightPanel';
import { LibraryTable } from './components/LibraryTable';
import { Sidebar } from './components/Sidebar';
import type {
  Crate,
  DeckId,
  DeckState,
  PlayHistoryEntry,
  SortKey,
  SourceFilter,
  SpotifyImport,
  SpotifyProfile,
  SpotifyPlaylist,
  Track,
  UserTrackMeta
} from './types';
import './styles.css';

type ConsoleLevel = 'info' | 'success' | 'error';

interface ConsoleEntry {
  id: string;
  level: ConsoleLevel;
  message: string;
  timestamp: string;
}

const INITIAL_DECKS: Record<DeckId, DeckState> = {
  A: {
    deckId: 'A',
    loadedTrackId: null,
    isPlaying: false,
    currentTime: 0,
    volume: 0.92,
    playbackRate: 1,
    cuePoints: [],
    syncEnabled: false
  },
  B: {
    deckId: 'B',
    loadedTrackId: null,
    isPlaying: false,
    currentTime: 0,
    volume: 0.92,
    playbackRate: 1,
    cuePoints: [],
    syncEnabled: false
  }
};

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function createConsoleTimestamp() {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export default function App() {
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [spotifyTracks, setSpotifyTracks] = useState<Track[]>([]);
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [spotifyProfile, setSpotifyProfile] = useState<SpotifyProfile | null>(null);
  const [spotifyClientId, setSpotifyClientId] = useState(() => localStorage.getItem('peak.spotifyClientId') || '');
  const [spotifyRedirectUri, setSpotifyRedirectUri] = useState('http://127.0.0.1:47832/spotify/callback');
  const [localFolderPath, setLocalFolderPath] = useState<string | null>(null);
  const [selectedCrateId, setSelectedCrateId] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('artist');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [searchText, setSearchText] = useState('');
  const [analysisQueue, setAnalysisQueue] = useState<string[]>([]);
  const [analyzingTrackId, setAnalyzingTrackId] = useState<string | null>(null);
  const [decks, setDecks] = useState<Record<DeckId, DeckState>>(INITIAL_DECKS);
  const [isScanning, setIsScanning] = useState(false);
  const [isSpotifyBusy, setIsSpotifyBusy] = useState(false);
  const [notice, setNotice] = useState('Dual-deck workspace online. Scan a folder or sync Spotify to build the first crates.');
  const [error, setError] = useState<string | null>(null);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>(() => [
    {
      id: 'startup',
      level: 'info',
      message: 'Dual-deck workspace online. Scan a folder or sync Spotify to build the first crates.',
      timestamp: createConsoleTimestamp()
    }
  ]);

  const [userTrackMeta, setUserTrackMeta] = useState<Map<string, UserTrackMeta>>(() => {
    try {
      const raw = localStorage.getItem('peak.userTrackMeta');
      if (raw) return new Map(JSON.parse(raw));
    } catch { /* ignore */ }
    return new Map();
  });
  const [playHistory, setPlayHistory] = useState<PlayHistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem('peak.playHistory');
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return [];
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const bufferCacheRef = useRef(new Map<string, ArrayBuffer>());
  const playbackUrlCacheRef = useRef(new Map<string, string>());
  const analysisWasActiveRef = useRef(false);
  const localTracksRef = useRef(localTracks);
  localTracksRef.current = localTracks;
  const analysisRunningRef = useRef(false);
  const deferredSearch = useDeferredValue(searchText);

  const { tracks, crates: baseCrates } = useMemo(
    () => mergeTrackLibraries(localTracks, spotifyTracks, spotifyPlaylists, localFolderPath),
    [localTracks, spotifyTracks, spotifyPlaylists, localFolderPath]
  );

  const userCrates = useMemo<Crate[]>(() => {
    const result: Crate[] = [];
    const favIds = tracks.filter((t) => userTrackMeta.get(t.id)?.favorite).map((t) => t.id);
    const removedIds = tracks.filter((t) => userTrackMeta.get(t.id)?.removed).map((t) => t.id);

    const seen = new Set<string>();
    const historyIds: string[] = [];
    for (const entry of playHistory) {
      if (!seen.has(entry.trackId) && tracks.some((t) => t.id === entry.trackId)) {
        seen.add(entry.trackId);
        historyIds.push(entry.trackId);
        if (historyIds.length >= 50) break;
      }
    }

    if (favIds.length > 0) {
      result.push({ id: 'smart:favorites', name: 'Favorites', description: 'Starred tracks', kind: 'smart', source: 'ai', accent: 'amber', trackIds: favIds });
    }
    if (historyIds.length > 0) {
      result.push({ id: 'smart:history', name: 'History', description: 'Recently loaded tracks', kind: 'smart', source: 'ai', accent: 'cyan', trackIds: historyIds });
    }
    if (removedIds.length > 0) {
      result.push({ id: 'smart:removed', name: 'Removed', description: 'Hidden tracks', kind: 'smart', source: 'ai', accent: 'magenta', trackIds: removedIds });
    }

    return result;
  }, [tracks, userTrackMeta, playHistory]);

  const crates = useMemo(() => [...baseCrates, ...userCrates], [baseCrates, userCrates]);

  const visibleTracks = useMemo(
    () => getVisibleTracks(tracks, crates, selectedCrateId, deferredSearch, sortKey, sortDirection, sourceFilter, userTrackMeta),
    [tracks, crates, selectedCrateId, deferredSearch, sortKey, sortDirection, sourceFilter, userTrackMeta]
  );

  const trackMap = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const deckATrack = decks.A.loadedTrackId ? trackMap.get(decks.A.loadedTrackId) || null : null;
  const deckBTrack = decks.B.loadedTrackId ? trackMap.get(decks.B.loadedTrackId) || null : null;
  const referenceDeckId: DeckId = decks.A.isPlaying
    ? 'A'
    : decks.B.isPlaying
      ? 'B'
      : decks.A.loadedTrackId
        ? 'A'
        : decks.B.loadedTrackId
          ? 'B'
          : 'A';
  const referenceTrack = referenceDeckId === 'A' ? deckATrack : deckBTrack;
  const suggestionTargetDeck: DeckId = referenceDeckId === 'A' ? 'B' : 'A';
  const setArcSummary = useMemo(() => buildSetArcSummary(tracks), [tracks]);
  const mixNarrative = useMemo(() => buildMixNarrative(deckATrack, deckBTrack), [deckATrack, deckBTrack]);
  const suggestions = useMemo(
    () =>
      getTransitionSuggestions(
        referenceTrack,
        tracks,
        [decks.A.loadedTrackId, decks.B.loadedTrackId].filter(Boolean) as string[]
      ),
    [referenceTrack, tracks, decks.A.loadedTrackId, decks.B.loadedTrackId]
  );

  const playableLocalTracks = useMemo(
    () => localTracks.filter((track) => track.availability === 'playable'),
    [localTracks]
  );
  const analyzedCount = localTracks.filter((track) => !needsAnalysis(track)).length;
  const analysisPendingCount = playableLocalTracks.filter((track) => needsAnalysis(track)).length;
  const analysisTotalCount = playableLocalTracks.length;
  const analysisCompletedCount = Math.max(0, analysisTotalCount - analysisPendingCount);
  const analysisPercent = analysisTotalCount > 0 ? Math.round((analysisCompletedCount / analysisTotalCount) * 100) : 0;
  const currentAnalyzingTrack = analyzingTrackId ? localTracks.find((track) => track.id === analyzingTrackId) || null : null;
  const activeCrateName = crates.find((crate) => crate.id === selectedCrateId)?.name || 'All Tracks';

  const appendConsoleEntry = useCallback((level: ConsoleLevel, message: string) => {
    const entry: ConsoleEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      level,
      message,
      timestamp: createConsoleTimestamp()
    };

    setConsoleEntries((current) => [entry, ...current].slice(0, 60));
  }, []);

  const publishNotice = useCallback(
    (message: string, level: Exclude<ConsoleLevel, 'error'> = 'info') => {
      setError(null);
      setNotice(message);
      appendConsoleEntry(level, message);
    },
    [appendConsoleEntry]
  );

  const publishError = useCallback(
    (message: string) => {
      setError(message);
      appendConsoleEntry('error', message);
    },
    [appendConsoleEntry]
  );

  useEffect(() => {
    localStorage.setItem('peak.spotifyClientId', spotifyClientId);
  }, [spotifyClientId]);

  useEffect(() => {
    localStorage.setItem('peak.userTrackMeta', JSON.stringify([...userTrackMeta]));
  }, [userTrackMeta]);

  useEffect(() => {
    localStorage.setItem('peak.playHistory', JSON.stringify(playHistory));
  }, [playHistory]);

  useEffect(() => {
    void window.appAPI.getSpotifyRedirectUri().then(setSpotifyRedirectUri).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!crates.some((crate) => crate.id === selectedCrateId)) {
      setSelectedCrateId('all');
    }
  }, [crates, selectedCrateId]);

  useEffect(() => {
    return () => {
      playbackUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      playbackUrlCacheRef.current.clear();
    };
  }, []);

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

  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const ContextCtor = window.AudioContext;
      audioContextRef.current = new ContextCtor();
    }

    return audioContextRef.current;
  }, []);

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

  const getPlaybackUrl = useCallback(
    async (track: Track) => {
      if (!track.filePath || !track.mimeType) {
        throw new Error('This track cannot be loaded for local playback.');
      }

      const cached = playbackUrlCacheRef.current.get(track.filePath);
      if (cached) {
        return cached;
      }

      const buffer = await readTrackBuffer(track);
      const url = URL.createObjectURL(new Blob([buffer], { type: track.mimeType }));
      playbackUrlCacheRef.current.set(track.filePath, url);
      return url;
    },
    [readTrackBuffer]
  );

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

  const handleDeckChange = useCallback((deckId: DeckId, updates: Partial<DeckState>) => {
    setDecks((current) => ({
      ...current,
      [deckId]: {
        ...current[deckId],
        ...updates
      }
    }));
  }, []);

  const handleAddCue = useCallback((deckId: DeckId, time: number) => {
    setDecks((current) => {
      const roundedTime = Number(time.toFixed(2));
      const currentDeck = current[deckId];
      if (currentDeck.cuePoints.some((cuePoint) => Math.abs(cuePoint - roundedTime) < 0.1)) {
        return current;
      }

      return {
        ...current,
        [deckId]: {
          ...currentDeck,
          cuePoints: [...currentDeck.cuePoints, roundedTime].sort((left, right) => left - right).slice(0, 8)
        }
      };
    });
  }, []);

  const handleToggleFavorite = useCallback((trackId: string) => {
    setUserTrackMeta((current) => {
      const next = new Map(current);
      const meta = next.get(trackId) || {};
      next.set(trackId, { ...meta, favorite: !meta.favorite });
      return next;
    });
  }, []);

  const handleTogglePin = useCallback((trackId: string) => {
    setUserTrackMeta((current) => {
      const next = new Map(current);
      const meta = next.get(trackId) || {};
      next.set(trackId, { ...meta, pinned: !meta.pinned });
      return next;
    });
  }, []);

  const handleRemoveTrack = useCallback((trackId: string) => {
    setUserTrackMeta((current) => {
      const next = new Map(current);
      const meta = next.get(trackId) || {};
      next.set(trackId, { ...meta, removed: !meta.removed });
      return next;
    });
  }, []);

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

    analysisRunningRef.current = true;
    setAnalyzingTrackId(nextTrackId);
    appendConsoleEntry('info', `Analyzing ${track.title} for BPM, key, waveform, and energy.`);

    void (async () => {
      try {
        const audioBuffer = await readTrackBuffer(track);
        const ctx = ensureAudioContext();
        const analysis = await analyzeAudioFile(audioBuffer, ctx);

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
              waveformBands: analysis.waveformBands,
              analysisSource: 'local-analysis'
            };
          })
        );
        appendConsoleEntry('success', `Analyzed ${track.title}.`);
      } catch (reason) {
        publishError(reason instanceof Error ? reason.message : `Track analysis failed for ${track.title}.`);
      } finally {
        analysisRunningRef.current = false;
        setAnalyzingTrackId(null);
        setAnalysisQueue((current) => current.filter((id) => id !== nextTrackId));
      }
    })();
  }, [analysisQueue, appendConsoleEntry, ensureAudioContext, publishError, readTrackBuffer]);

  const handleOpenExternal = async (url: string) => {
    await window.appAPI.openExternal(url);
  };

  const handleLoadTrack = (deckId: DeckId, trackId: string) => {
    const track = trackMap.get(trackId);
    if (!track) {
      return;
    }

    if (track.availability !== 'playable') {
      if (track.spotifyUrl) {
        void handleOpenExternal(track.spotifyUrl);
      }
      return;
    }

    queueTracksForAnalysis(needsAnalysis(track) ? [track.id] : [], true);
    setPlayHistory((current) => [
      { trackId, deckId, loadedAt: new Date().toISOString() },
      ...current
    ].slice(0, 200));
    setDecks((current) => ({
      ...current,
      [deckId]: {
        ...current[deckId],
        loadedTrackId: trackId,
        isPlaying: false,
        currentTime: 0,
        playbackRate: 1,
        cuePoints: []
      }
    }));
    publishNotice(`Loaded ${track.title} onto Deck ${deckId}.`, 'success');
  };

  const handleSyncDeck = (deckId: DeckId) => {
    const currentTrack = deckId === 'A' ? deckATrack : deckBTrack;
    const otherTrack = deckId === 'A' ? deckBTrack : deckATrack;

    if (!currentTrack?.bpm || !otherTrack?.bpm) {
      publishError('Both decks need BPM analysis before sync can lock to a target.');
      return;
    }

    const playbackRate = Math.min(1.15, Math.max(0.85, otherTrack.bpm / currentTrack.bpm));
    handleDeckChange(deckId, {
      playbackRate,
      syncEnabled: true
    });
    publishNotice(`Deck ${deckId} sync locked toward ${otherTrack.bpm.toFixed(1)} BPM.`, 'success');
  };

  const handleScanFolder = async () => {
    setError(null);
    setIsScanning(true);

    try {
      const folderPath = await window.appAPI.selectMusicFolder();
      if (!folderPath) {
        return;
      }

      const scannedTracks = await window.appAPI.scanMusicFolder(folderPath);

      startTransition(() => {
        setLocalFolderPath(folderPath);
        setLocalTracks(scannedTracks);
        setSelectedCrateId('all');
      });

      bufferCacheRef.current.clear();
      playbackUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      playbackUrlCacheRef.current.clear();
      setDecks(INITIAL_DECKS);
      const queuedIds = scannedTracks.filter((track) => needsAnalysis(track)).map((track) => track.id);
      queueTracksForAnalysis(queuedIds, true);
      publishNotice(`Scanned ${scannedTracks.length} tracks from ${folderPath.split('/').filter(Boolean).pop()}.`, 'success');
      if (queuedIds.length > 0) {
        appendConsoleEntry('info', `Queued ${queuedIds.length} local tracks for post-scan analysis.`);
      }
      const scanFallbackCount = scannedTracks.filter((track) => Boolean(track.scanError)).length;
      if (scanFallbackCount > 0) {
        appendConsoleEntry('error', `${scanFallbackCount} files fell back to basic metadata because tag parsing was incomplete.`);
      }
    } catch (reason) {
      publishError(reason instanceof Error ? reason.message : 'Music folder scan failed.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleAnalyzeAll = () => {
    const analyzableIds = localTracks.filter((track) => needsAnalysis(track)).map((track) => track.id);
    if (analyzableIds.length === 0) {
      publishNotice('All playable local tracks already have analysis data.', 'success');
      return;
    }

    queueTracksForAnalysis(analyzableIds, true);
    publishNotice(`Queued ${analyzableIds.length} local tracks for BPM, key, energy, and waveform analysis.`);
  };

  const handleSpotifyConnect = async () => {
    if (!spotifyClientId.trim()) {
      publishError('Enter your Spotify Client ID first.');
      return;
    }

    setError(null);
    setIsSpotifyBusy(true);

    try {
      const session = await window.appAPI.spotifyLogin(spotifyClientId.trim());
      setSpotifyProfile(session.profile);
      publishNotice(`Spotify connected as ${session.profile.displayName}.`, 'success');
    } catch (reason) {
      publishError(reason instanceof Error ? reason.message : 'Spotify connection failed.');
    } finally {
      setIsSpotifyBusy(false);
    }
  };

  const handleSpotifySync = async () => {
    setError(null);
    setIsSpotifyBusy(true);

    try {
      const payload: SpotifyImport = await window.appAPI.spotifySync();

      startTransition(() => {
        setSpotifyProfile(payload.profile);
        setSpotifyTracks(payload.savedTracks);
        setSpotifyPlaylists(payload.playlists);
      });

      queueTracksForAnalysis(localTracks.filter((track) => needsAnalysis(track)).map((track) => track.id));
      publishNotice(`Spotify sync pulled ${payload.savedTracks.length} saved tracks and ${payload.playlists.length} playlists.`, 'success');
    } catch (reason) {
      publishError(reason instanceof Error ? reason.message : 'Spotify import failed.');
    } finally {
      setIsSpotifyBusy(false);
    }
  };

  const handleSpotifyLogout = async () => {
    await window.appAPI.spotifyLogout();
    setSpotifyProfile(null);
    setSpotifyTracks([]);
    setSpotifyPlaylists([]);
    publishNotice('Spotify connection cleared. Local DJ workflow stays intact.');
  };

  return (
    <div className="app-shell">
      <Sidebar
        crates={crates}
        selectedCrateId={selectedCrateId}
        localFolderPath={localFolderPath}
        spotifyProfile={spotifyProfile}
        spotifyClientId={spotifyClientId}
        spotifyRedirectUri={spotifyRedirectUri}
        stats={{
          total: tracks.length,
          playable: tracks.filter((track) => track.availability === 'playable').length,
          matched: tracks.filter((track) => track.source === 'matched').length,
          analyzed: analyzedCount
        }}
        analysis={{
          total: analysisTotalCount,
          completed: analysisCompletedCount,
          pending: analysisPendingCount,
          percent: analysisPercent,
          active: Boolean(analyzingTrackId || analysisQueue.length > 0),
          currentTrackTitle: currentAnalyzingTrack?.title || null
        }}
        scanning={isScanning}
        syncingSpotify={isSpotifyBusy}
        onSelectCrate={setSelectedCrateId}
        onSpotifyClientIdChange={setSpotifyClientId}
        onScanFolder={() => void handleScanFolder()}
        onAnalyzeAll={handleAnalyzeAll}
        onSpotifyConnect={() => void handleSpotifyConnect()}
        onSpotifySync={() => void handleSpotifySync()}
        onSpotifyLogout={() => void handleSpotifyLogout()}
      />

      <main className="main-stage">
        <header className="topbar">
          <div>
            <p className="eyebrow">Desk View</p>
            <h1>Two-deck command center with smart crates, waveform intelligence, and library fusion.</h1>
          </div>
        </header>

        <div className={`banner ${error ? 'error' : 'info'}`}>
          <strong>{error ? 'System Alert' : 'Operator Feed'}</strong>
          <span>{error || notice}</span>
        </div>

        <section className="decks-grid">
          <DeckPanel
            deck={decks.A}
            track={deckATrack}
            oppositeTrack={deckBTrack}
            accent="cyan"
            analysisPending={Boolean(deckATrack && needsAnalysis(deckATrack))}
            getPlaybackUrl={getPlaybackUrl}
            onDeckChange={handleDeckChange}
            onAddCue={handleAddCue}
            onSync={handleSyncDeck}
            onOpenExternal={(url) => void handleOpenExternal(url)}
          />
          <DeckPanel
            deck={decks.B}
            track={deckBTrack}
            oppositeTrack={deckATrack}
            accent="amber"
            analysisPending={Boolean(deckBTrack && needsAnalysis(deckBTrack))}
            getPlaybackUrl={getPlaybackUrl}
            onDeckChange={handleDeckChange}
            onAddCue={handleAddCue}
            onSync={handleSyncDeck}
            onOpenExternal={(url) => void handleOpenExternal(url)}
          />
        </section>

        <section className="panel library-panel">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Unified Library</p>
              <h2>{visibleTracks.length} tracks in view</h2>
            </div>
            <span className="muted">
              {analyzingTrackId ? `Analyzing ${trackMap.get(analyzingTrackId)?.title || 'track'}...` : `${analysisQueue.length} queued for analysis`}
            </span>
          </div>
          <div className="library-toolbar">
            <label className="search-field library-search-field">
              <span>Search Library</span>
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Find by title, artist, album, genre, or tag"
              />
            </label>

            <label className="select-field">
              <span>Sort</span>
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                <option value="artist">Artist</option>
                <option value="title">Title</option>
                <option value="album">Album</option>
                <option value="bpm">BPM</option>
                <option value="energy">Energy</option>
                <option value="duration">Duration</option>
                <option value="source">Source</option>
              </select>
            </label>

            <label className="select-field">
              <span>Filter</span>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}>
                <option value="all">All sources</option>
                <option value="playable">Playable</option>
                <option value="metadata-only">Metadata only</option>
                <option value="local">Local only</option>
                <option value="spotify">Spotify only</option>
                <option value="matched">Matched</option>
              </select>
            </label>

            <button className="sort-toggle" onClick={() => setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}>
              {sortDirection === 'asc' ? 'Asc' : 'Desc'}
            </button>
          </div>
          <div className="analysis-status-card">
            <div className="analysis-meter-head">
              <strong>
                {currentAnalyzingTrack
                  ? `Analyzing ${currentAnalyzingTrack.title}`
                  : analysisPendingCount > 0
                    ? `${analysisPendingCount} tracks still need analysis`
                    : 'Analysis complete'}
              </strong>
              <span>{analysisCompletedCount}/{analysisTotalCount || 0} ready</span>
            </div>
            <div className="analysis-progress-track">
              <span className="analysis-progress-fill" style={{ width: `${analysisPercent}%` }} />
            </div>
            <p className="muted">
              Crate: {activeCrateName}. The unified library viewport is locked to roughly five rows with a vertical scrollbar for tighter crate digging.
            </p>
          </div>
          <LibraryTable
            tracks={visibleTracks}
            analyzingTrackId={analyzingTrackId}
            userTrackMeta={userTrackMeta}
            onLoadTrack={handleLoadTrack}
            onOpenExternal={(url) => void handleOpenExternal(url)}
            onToggleFavorite={handleToggleFavorite}
            onTogglePin={handleTogglePin}
            onRemoveTrack={handleRemoveTrack}
          />
        </section>

        <section className="panel console-panel">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">System Console</p>
              <h2>Operator Log</h2>
            </div>
            <span className="muted">{consoleEntries.length} recent events</span>
          </div>
          <div className="console-feed">
            {consoleEntries.length > 0 ? (
              consoleEntries.map((entry) => (
                <div key={entry.id} className={`console-line console-${entry.level}`}>
                  <span className="console-time">{entry.timestamp}</span>
                  <span className="console-level">{entry.level.toUpperCase()}</span>
                  <span className="console-message">{entry.message}</span>
                </div>
              ))
            ) : (
              <div className="console-empty">No console events yet.</div>
            )}
          </div>
        </section>
      </main>

      <InsightPanel
        referenceTrack={referenceTrack}
        suggestions={suggestions}
        suggestionTargetDeck={suggestionTargetDeck}
        setArcSummary={setArcSummary}
        mixNarrative={mixNarrative}
        tracks={tracks}
        onLoadSuggestion={handleLoadTrack}
      />
    </div>
  );
}

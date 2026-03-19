import { useEffect, useRef, useState } from 'react';
import { formatBpm, formatDuration, formatKeyLabel } from '../lib/djEngine';
import { Waveform } from './Waveform';
import type { DeckId, DeckState, Track } from '../types';

interface DeckPanelProps {
  deck: DeckState;
  track: Track | null;
  oppositeTrack: Track | null;
  accent: 'cyan' | 'amber';
  analysisPending: boolean;
  getPlaybackUrl: (track: Track) => Promise<string>;
  onDeckChange: (deckId: DeckId, updates: Partial<DeckState>) => void;
  onAddCue: (deckId: DeckId, time: number) => void;
  onSync: (deckId: DeckId) => void;
  onOpenExternal: (url: string) => void;
}

export function DeckPanel({
  deck,
  track,
  oppositeTrack,
  accent,
  analysisPending,
  getPlaybackUrl,
  onDeckChange,
  onAddCue,
  onSync,
  onOpenExternal
}: DeckPanelProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioState, setAudioState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!track || track.availability !== 'playable') {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setAudioState('idle');
      setError(null);
      return;
    }

    let cancelled = false;
    setAudioState('loading');
    setError(null);

    getPlaybackUrl(track)
      .then((url) => {
        if (cancelled || !audio) {
          return;
        }

        if (audio.src !== url) {
          audio.pause();
          audio.src = url;
          audio.load();
        }

        setAudioState('ready');
      })
      .catch((reason) => {
        if (cancelled) {
          return;
        }

        setAudioState('error');
        setError(reason instanceof Error ? reason.message : 'Playback file could not be prepared.');
      });

    return () => {
      cancelled = true;
    };
  }, [track?.id, track?.availability, getPlaybackUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.volume = deck.volume;
  }, [deck.volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.playbackRate = deck.playbackRate;
  }, [deck.playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const handleTimeUpdate = () => {
      onDeckChange(deck.deckId, { currentTime: audio.currentTime });
    };

    const handlePlay = () => {
      onDeckChange(deck.deckId, { isPlaying: true });
    };

    const handlePause = () => {
      onDeckChange(deck.deckId, { isPlaying: false });
    };

    const handleEnded = () => {
      onDeckChange(deck.deckId, { isPlaying: false, currentTime: 0 });
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [deck.deckId, onDeckChange]);

  const duration = track?.duration || 0;
  const canPlay = track?.availability === 'playable' && audioState !== 'error';
  const hasOppositeTrack = Boolean(oppositeTrack);
  const deckTone = accent === 'cyan' ? 'deck-cyan' : 'deck-amber';

  const handleTogglePlayback = async () => {
    if (!track) {
      return;
    }

    if (track.availability !== 'playable') {
      if (track.spotifyUrl) {
        onOpenExternal(track.spotifyUrl);
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  };

  const handleScrub = (value: string) => {
    const audio = audioRef.current;
    if (!audio || duration <= 0) {
      return;
    }

    const nextTime = (Number(value) / 1000) * duration;
    audio.currentTime = nextTime;
    onDeckChange(deck.deckId, { currentTime: nextTime });
  };

  const handlePitchChange = (value: string) => {
    onDeckChange(deck.deckId, {
      playbackRate: Number(value),
      syncEnabled: false
    });
  };

  const handleAddCuePoint = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    onAddCue(deck.deckId, audio.currentTime);
  };

  const jumpToCue = (cuePoint: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.currentTime = cuePoint;
    onDeckChange(deck.deckId, { currentTime: cuePoint });
  };

  const jumpToStart = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.currentTime = 0;
    onDeckChange(deck.deckId, { currentTime: 0 });
  };

  return (
    <section className={`panel deck-panel ${deckTone}`}>
      <header className="deck-header">
        <div>
          <p className="eyebrow">Deck {deck.deckId}</p>
          <h2>{track ? track.title : `Awaiting track on Deck ${deck.deckId}`}</h2>
          <p className="deck-subtitle">
            {track ? `${track.artist} // ${track.album}` : 'Load a playable local file or a Spotify-matched track.'}
          </p>
        </div>

        <div className="deck-metrics">
          <span className="metric-chip">{formatBpm(track?.bpm)} BPM</span>
          <span className="metric-chip">{formatKeyLabel(track)}</span>
          <span className="metric-chip">ENG {track?.energy != null ? Math.round(track.energy) : '--'}</span>
        </div>
      </header>

      <div className="deck-topline">
        <span className={`status-pill ${track?.availability === 'playable' ? 'success' : 'warning'}`}>
          {track?.availability === 'playable' ? 'Deck ready' : track ? 'Metadata only' : 'No track'}
        </span>
        <span className={`status-pill ${analysisPending ? 'info' : 'success'}`}>
          {analysisPending ? 'Analyzing groove' : 'Analysis locked'}
        </span>
        <span className="status-pill neutral">
          {audioState === 'loading' ? 'Loading audio' : audioState === 'error' ? 'Playback issue' : 'Transport armed'}
        </span>
      </div>

      <Waveform
        data={track?.waveform || []}
        currentTime={deck.currentTime}
        duration={duration}
        bpm={track?.bpm || null}
        cuePoints={deck.cuePoints}
      />

      <div className="deck-transport">
        <button className="transport-button strong" onClick={() => void handleTogglePlayback()} disabled={!track}>
          {deck.isPlaying ? 'Pause' : 'Play'}
        </button>
        <button className="transport-button" onClick={jumpToStart} disabled={!track}>
          To Start
        </button>
        <button className="transport-button" onClick={handleAddCuePoint} disabled={!canPlay}>
          Set Cue
        </button>
        <button className="transport-button" onClick={() => onSync(deck.deckId)} disabled={!track || !hasOppositeTrack}>
          Sync
        </button>
        {track?.spotifyUrl ? (
          <button className="transport-button" onClick={() => onOpenExternal(track.spotifyUrl!)}>
            Spotify
          </button>
        ) : null}
      </div>

      <div className="deck-faders">
        <label className="deck-slider">
          <span>Seek</span>
          <input
            type="range"
            min="0"
            max="1000"
            value={duration > 0 ? Math.round((deck.currentTime / duration) * 1000) : 0}
            onChange={(event) => handleScrub(event.target.value)}
            disabled={!track || duration <= 0}
          />
        </label>

        <label className="deck-slider">
          <span>Pitch</span>
          <input
            type="range"
            min="0.85"
            max="1.15"
            step="0.005"
            value={deck.playbackRate}
            onChange={(event) => handlePitchChange(event.target.value)}
            disabled={!track}
          />
          <strong>{((deck.playbackRate - 1) * 100).toFixed(1)}%</strong>
        </label>

        <label className="deck-slider">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={deck.volume}
            onChange={(event) => onDeckChange(deck.deckId, { volume: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="deck-footer">
        <div className="cue-strip">
          {deck.cuePoints.length > 0 ? (
            deck.cuePoints.map((cuePoint, index) => (
              <button key={cuePoint} className="cue-pill" onClick={() => jumpToCue(cuePoint)}>
                C{index + 1} {formatDuration(cuePoint)}
              </button>
            ))
          ) : (
            <span className="muted">Set cue points to mark drops, loops, and vocal cuts.</span>
          )}
        </div>

        <div className="deck-summary">
          <span>{track?.genre || 'Genre pending'}</span>
          <span>{formatDuration(deck.currentTime)} / {formatDuration(duration)}</span>
        </div>
      </div>

      {error ? <p className="deck-error">{error}</p> : null}

      <audio ref={audioRef} preload="metadata" />
    </section>
  );
}

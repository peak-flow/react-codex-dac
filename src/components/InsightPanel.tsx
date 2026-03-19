import { formatBpm, formatKeyLabel } from '../lib/djEngine';
import type { DeckId, SetArcSummary, Track, TransitionSuggestion } from '../types';

interface InsightPanelProps {
  referenceTrack: Track | null;
  suggestions: TransitionSuggestion[];
  suggestionTargetDeck: DeckId;
  setArcSummary: SetArcSummary;
  mixNarrative: string;
  tracks: Track[];
  onLoadSuggestion: (deckId: DeckId, trackId: string) => void;
}

export function InsightPanel({
  referenceTrack,
  suggestions,
  suggestionTargetDeck,
  setArcSummary,
  mixNarrative,
  tracks,
  onLoadSuggestion
}: InsightPanelProps) {
  return (
    <aside className="insight-panel">
      <section className="panel insight-card">
        <p className="eyebrow">AI Transition Coach</p>
        <h2>{referenceTrack ? `Best next move after ${referenceTrack.title}` : 'Load a reference track to unlock next-track intelligence'}</h2>
        <p>{mixNarrative}</p>
      </section>

      <section className="panel insight-card">
        <div className="panel-title-row">
          <h2>Smart Suggestions</h2>
          <span className="muted">Target Deck {suggestionTargetDeck}</span>
        </div>
        <div className="suggestion-list">
          {suggestions.length > 0 ? (
            suggestions.map((suggestion) => {
              const track = tracks.find((item) => item.id === suggestion.trackId);
              if (!track) {
                return null;
              }

              return (
                <article key={suggestion.trackId} className="suggestion-card">
                  <div className="suggestion-head">
                    <div>
                      <strong>{track.title}</strong>
                      <span>{track.artist}</span>
                    </div>
                    <i>{suggestion.score}</i>
                  </div>
                  <div className="suggestion-meta">
                    <span>{formatBpm(track.bpm)} BPM</span>
                    <span>{formatKeyLabel(track)}</span>
                    <span>ENG {track.energy !== null ? Math.round(track.energy) : '--'}</span>
                  </div>
                  <p>{suggestion.reasons.join(' // ')}</p>
                  <button className="action-button strong" onClick={() => onLoadSuggestion(suggestionTargetDeck, track.id)}>
                    Send To Deck {suggestionTargetDeck}
                  </button>
                </article>
              );
            })
          ) : (
            <p className="muted">
              Analyze a few tracks, then load one onto a deck. PEAK will score BPM, harmonic compatibility, and energy movement.
            </p>
          )}
        </div>
      </section>

      <section className="panel insight-card">
        <p className="eyebrow">Set Arc</p>
        <h2>{setArcSummary.headline}</h2>
        <p>{setArcSummary.body}</p>
        <p className="muted">{setArcSummary.recommendation}</p>
      </section>
    </aside>
  );
}

import { formatBpm, formatDuration, formatKeyLabel } from '../lib/djEngine';
import type { DeckId, Track, UserTrackMeta } from '../types';

interface LibraryTableProps {
  tracks: Track[];
  analyzingTrackId: string | null;
  userTrackMeta: Map<string, UserTrackMeta>;
  onLoadTrack: (deckId: DeckId, trackId: string) => void;
  onOpenExternal: (url: string) => void;
  onToggleFavorite: (trackId: string) => void;
  onTogglePin: (trackId: string) => void;
  onRemoveTrack: (trackId: string) => void;
}

export function LibraryTable({
  tracks,
  analyzingTrackId,
  userTrackMeta,
  onLoadTrack,
  onOpenExternal,
  onToggleFavorite,
  onTogglePin,
  onRemoveTrack
}: LibraryTableProps) {
  return (
    <div className="library-table-wrap">
      <table className="library-table">
        <thead>
          <tr>
            <th style={{ width: '40px' }}></th>
            <th>Track</th>
            <th>Artist</th>
            <th>BPM</th>
            <th>Key</th>
            <th>Energy</th>
            <th>Duration</th>
            <th>Source</th>
            <th className="actions">Action</th>
          </tr>
        </thead>
        <tbody>
          {tracks.length > 0 ? (
            tracks.map((track) => {
              const isAnalyzing = analyzingTrackId === track.id;
              const meta = userTrackMeta.get(track.id);
              return (
                <tr key={track.id} className={`track-row ${track.availability === 'playable' ? 'playable' : 'metadata-only'}${meta?.pinned ? ' pinned-row' : ''}`}>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className={`icon-btn${meta?.favorite ? ' active-fav' : ''}`}
                      onClick={() => onToggleFavorite(track.id)}
                      title={meta?.favorite ? 'Unfavorite' : 'Favorite'}
                    >
                      {meta?.favorite ? '\u2605' : '\u2606'}
                    </button>
                  </td>
                  <td>
                    <div className="track-cell">
                      <strong>
                        {meta?.pinned ? <span className="pin-indicator" title="Pinned">{'\u{1F4CC}'} </span> : null}
                        {track.title}
                      </strong>
                      <span>{track.genre || 'No genre tag'}</span>
                    </div>
                  </td>
                  <td>{track.artist}</td>
                  <td>{isAnalyzing ? 'ANL' : formatBpm(track.bpm)}</td>
                  <td>{formatKeyLabel(track)}</td>
                  <td>
                    <div className="energy-cell">
                      <span>{track.energy !== null ? Math.round(track.energy) : '--'}</span>
                      <i style={{ width: `${track.energy !== null ? track.energy : 4}%` }} />
                    </div>
                  </td>
                  <td>{formatDuration(track.duration)}</td>
                  <td>
                    <span className={`source-pill source-${track.source}`}>{track.source}</span>
                  </td>
                  <td className="actions">
                    <div className="action-row">
                      <button
                        className={`icon-btn${meta?.pinned ? ' active-pin' : ''}`}
                        onClick={() => onTogglePin(track.id)}
                        title={meta?.pinned ? 'Unpin' : 'Pin to top'}
                      >
                        {meta?.pinned ? '\u2002\u25C9' : '\u2002\u25CB'}
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => onRemoveTrack(track.id)}
                        title={meta?.removed ? 'Restore' : 'Remove'}
                      >
                        {meta?.removed ? '\u21A9' : '\u2715'}
                      </button>
                      {track.availability === 'playable' ? (
                        <>
                          <button className="table-button" onClick={() => onLoadTrack('A', track.id)}>A</button>
                          <button className="table-button alt" onClick={() => onLoadTrack('B', track.id)}>B</button>
                        </>
                      ) : track.spotifyUrl ? (
                        <button className="table-button alt" onClick={() => onOpenExternal(track.spotifyUrl!)}>Open</button>
                      ) : (
                        <span className="muted">No file</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={9}>
                <div className="library-empty">
                  <strong>No tracks in the current view.</strong>
                  <span>Scan a folder, sync Spotify, or change the crate filter to start building the library.</span>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

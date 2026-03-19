import { formatBpm, formatDuration, formatKeyLabel } from '../lib/djEngine';
import type { DeckId, Track } from '../types';

interface LibraryTableProps {
  tracks: Track[];
  analyzingTrackId: string | null;
  onLoadTrack: (deckId: DeckId, trackId: string) => void;
  onOpenExternal: (url: string) => void;
}

export function LibraryTable({ tracks, analyzingTrackId, onLoadTrack, onOpenExternal }: LibraryTableProps) {
  return (
    <div className="library-table-wrap">
      <table className="library-table">
        <thead>
          <tr>
            <th>Track</th>
            <th>Artist</th>
            <th>Album</th>
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
              return (
                <tr key={track.id} className={`track-row ${track.availability === 'playable' ? 'playable' : 'metadata-only'}`}>
                  <td>
                    <div className="track-cell">
                      <strong>{track.title}</strong>
                      <span>{track.genre || 'No genre tag'}</span>
                    </div>
                  </td>
                  <td>{track.artist}</td>
                  <td>{track.album}</td>
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
                    {track.availability === 'playable' ? (
                      <div className="action-row">
                        <button className="table-button" onClick={() => onLoadTrack('A', track.id)}>
                          Load A
                        </button>
                        <button className="table-button alt" onClick={() => onLoadTrack('B', track.id)}>
                          Load B
                        </button>
                      </div>
                    ) : track.spotifyUrl ? (
                      <button className="table-button alt" onClick={() => onOpenExternal(track.spotifyUrl!)}>
                        Open
                      </button>
                    ) : (
                      <span className="muted">Need local match</span>
                    )}
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

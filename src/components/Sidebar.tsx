import type { Crate, SpotifyProfile } from '../types';

interface SidebarProps {
  crates: Crate[];
  selectedCrateId: string;
  localFolderPath: string | null;
  spotifyProfile: SpotifyProfile | null;
  spotifyClientId: string;
  spotifyRedirectUri: string;
  stats: {
    total: number;
    playable: number;
    matched: number;
    analyzed: number;
  };
  scanning: boolean;
  syncingSpotify: boolean;
  onSelectCrate: (crateId: string) => void;
  onSpotifyClientIdChange: (value: string) => void;
  onScanFolder: () => void;
  onAnalyzeAll: () => void;
  onSpotifyConnect: () => void;
  onSpotifySync: () => void;
  onSpotifyLogout: () => void;
}

export function Sidebar({
  crates,
  selectedCrateId,
  localFolderPath,
  spotifyProfile,
  spotifyClientId,
  spotifyRedirectUri,
  stats,
  scanning,
  syncingSpotify,
  onSelectCrate,
  onSpotifyClientIdChange,
  onScanFolder,
  onAnalyzeAll,
  onSpotifyConnect,
  onSpotifySync,
  onSpotifyLogout
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <section className="panel sidebar-hero">
        <p className="eyebrow">PEAK DJ Command</p>
        <h1>Broadcast-grade DJ control with local audio intelligence and Spotify-powered crate context.</h1>
        <div className="stats-grid">
          <div className="stat-block">
            <span>Total</span>
            <strong>{stats.total}</strong>
          </div>
          <div className="stat-block">
            <span>Playable</span>
            <strong>{stats.playable}</strong>
          </div>
          <div className="stat-block">
            <span>Matched</span>
            <strong>{stats.matched}</strong>
          </div>
          <div className="stat-block">
            <span>Analyzed</span>
            <strong>{stats.analyzed}</strong>
          </div>
        </div>
        <div className="hero-actions">
          <button className="action-button strong" onClick={onScanFolder} disabled={scanning}>
            {scanning ? 'Scanning...' : 'Scan Music Folder'}
          </button>
          <button className="action-button" onClick={onAnalyzeAll} disabled={stats.playable === 0}>
            Analyze All
          </button>
        </div>
        <p className="path-pill">{localFolderPath || 'No local folder scanned yet.'}</p>
      </section>

      <section className="panel spotify-panel">
        <div className="panel-title-row">
          <h2>Spotify Bridge</h2>
          <span className={`status-pill ${spotifyProfile ? 'success' : 'warning'}`}>
            {spotifyProfile ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <label className="stacked-input">
          <span>Client ID</span>
          <input
            value={spotifyClientId}
            onChange={(event) => onSpotifyClientIdChange(event.target.value)}
            placeholder="Paste your Spotify Client ID"
          />
        </label>
        <div className="spotify-actions">
          <button className="action-button strong" onClick={onSpotifyConnect} disabled={syncingSpotify}>
            Connect
          </button>
          <button className="action-button" onClick={onSpotifySync} disabled={syncingSpotify || !spotifyProfile}>
            {syncingSpotify ? 'Syncing...' : 'Sync Library'}
          </button>
          <button className="action-button ghost" onClick={onSpotifyLogout} disabled={!spotifyProfile}>
            Disconnect
          </button>
        </div>
        <div className="spotify-meta">
          <p>{spotifyProfile ? `${spotifyProfile.displayName} // ${spotifyProfile.product}` : 'Spotify imports track metadata, playlists, and library context.'}</p>
          <p className="muted">Register this redirect URI in the Spotify dashboard:</p>
          <code>{spotifyRedirectUri}</code>
        </div>
      </section>

      <section className="panel crates-panel">
        <div className="panel-title-row">
          <h2>Crates</h2>
          <span className="muted">{crates.length} views</span>
        </div>
        <div className="crate-list">
          {crates.map((crate) => (
            <button
              key={crate.id}
              className={`crate-button ${selectedCrateId === crate.id ? 'active' : ''}`}
              onClick={() => onSelectCrate(crate.id)}
            >
              <span>
                <strong>{crate.name}</strong>
                <small>{crate.description}</small>
              </span>
              <i>{crate.trackIds.length}</i>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

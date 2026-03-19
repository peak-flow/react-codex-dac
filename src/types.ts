export type DeckId = 'A' | 'B';
export type TrackSource = 'local' | 'spotify' | 'matched';
export type TrackAvailability = 'playable' | 'metadata-only';
export type CrateKind = 'collection' | 'folder' | 'spotify' | 'smart';
export type CrateSource = 'system' | 'local' | 'spotify' | 'ai';
export type SortKey = 'title' | 'artist' | 'album' | 'bpm' | 'energy' | 'duration' | 'source';
export type SourceFilter =
  | 'all'
  | 'playable'
  | 'metadata-only'
  | 'local'
  | 'spotify'
  | 'matched';

export interface Track {
  id: string;
  source: TrackSource;
  availability: TrackAvailability;
  title: string;
  artist: string;
  album: string;
  duration: number;
  bpm: number | null;
  key: string | null;
  camelotKey: string | null;
  energy: number | null;
  genre: string | null;
  tags: string[];
  filePath: string | null;
  mimeType: string | null;
  folderPath: string | null;
  fileName: string | null;
  isrc: string | null;
  trackNumber: number | null;
  addedAt: string | null;
  spotifyId: string | null;
  spotifyUrl: string | null;
  coverUrl: string | null;
  waveform: number[];
  bpmConfidence: number;
  keyConfidence: number;
  popularity: number | null;
  analysisSource: 'pending' | 'tags' | 'local-analysis' | 'spotify';
  scanError?: string;
}

export interface TrackAnalysis {
  bpm: number | null;
  bpmConfidence: number;
  key: string | null;
  camelotKey: string | null;
  keyConfidence: number;
  energy: number | null;
  waveform: number[];
  analysisSource: 'local-analysis';
}

export interface SpotifyProfile {
  id: string;
  displayName: string;
  product: string;
  imageUrl: string | null;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  source: 'spotify';
  trackIds: string[];
  importError?: string;
}

export interface SpotifyImport {
  profile: SpotifyProfile;
  savedTracks: Track[];
  playlists: SpotifyPlaylist[];
}

export interface Crate {
  id: string;
  name: string;
  description: string;
  kind: CrateKind;
  source: CrateSource;
  accent: string;
  trackIds: string[];
}

export interface DeckState {
  deckId: DeckId;
  loadedTrackId: string | null;
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  playbackRate: number;
  cuePoints: number[];
  syncEnabled: boolean;
}

export interface TransitionSuggestion {
  trackId: string;
  score: number;
  lane: 'lift' | 'steady' | 'reset';
  reasons: string[];
  compatibility: {
    bpm: number;
    key: number;
    energy: number;
    tags: number;
  };
}

export interface SetArcSummary {
  headline: string;
  body: string;
  recommendation: string;
}

/// <reference types="vite/client" />

import type { SpotifyImport, SpotifyProfile, Track } from './types';

declare global {
  interface Window {
    appAPI: {
      selectMusicFolder: () => Promise<string | null>;
      scanMusicFolder: (folderPath: string) => Promise<Track[]>;
      readAudioFile: (filePath: string) => Promise<Uint8Array>;
      openExternal: (url: string) => Promise<void>;
      spotifyLogin: (clientId: string) => Promise<{
        connected: boolean;
        redirectUri: string;
        profile: SpotifyProfile;
      }>;
      spotifySync: () => Promise<SpotifyImport>;
      spotifyLogout: () => Promise<{ connected: boolean }>;
      getSpotifyRedirectUri: () => Promise<string>;
    };
  }
}

export {};

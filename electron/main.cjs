const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const http = require('node:http');

const DEV_SERVER_URL = 'http://127.0.0.1:5173';
const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:47832/spotify/callback';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.m4a',
  '.aac',
  '.wav',
  '.aiff',
  '.aif',
  '.flac',
  '.ogg',
  '.opus'
]);

let mainWindow;
let spotifySession = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1040,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: '#080d12',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
    return;
  }

  mainWindow.loadURL(DEV_SERVER_URL);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildTrackId(prefix, value) {
  return `${prefix}:${crypto.createHash('sha1').update(value).digest('hex').slice(0, 14)}`;
}

function guessMimeType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.wav':
      return 'audio/wav';
    case '.aiff':
    case '.aif':
      return 'audio/aiff';
    case '.flac':
      return 'audio/flac';
    case '.ogg':
      return 'audio/ogg';
    case '.opus':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
}

function fallbackTitleFromFile(filePath) {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[_-]+/g, ' ')
    .trim();
}

async function walkMusicFiles(rootPath) {
  const output = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        output.push(fullPath);
      }
    }
  }

  return output.sort((left, right) => left.localeCompare(right));
}

async function parseLocalTrack(filePath) {
  const mm = await import('music-metadata');
  const extension = path.extname(filePath).toLowerCase();

  try {
    const metadata = await mm.parseFile(filePath, { duration: true, skipCovers: true });
    const common = metadata.common ?? {};
    const format = metadata.format ?? {};
    const artists = Array.isArray(common.artists) && common.artists.length > 0
      ? common.artists.join(', ')
      : common.artist || common.albumartist || 'Unknown artist';

    return {
      id: buildTrackId('local', filePath),
      source: 'local',
      availability: 'playable',
      title: common.title || fallbackTitleFromFile(filePath),
      artist: artists,
      album: common.album || 'Unsorted',
      duration: Math.round(format.duration || 0),
      bpm: typeof common.bpm === 'number' ? Math.round(common.bpm * 10) / 10 : null,
      key: common.initialKey || common.key || null,
      energy: null,
      genre: Array.isArray(common.genre) && common.genre.length > 0 ? common.genre[0] : null,
      tags: Array.isArray(common.genre) ? common.genre : [],
      filePath,
      mimeType: guessMimeType(filePath),
      folderPath: path.dirname(filePath),
      fileName: path.basename(filePath),
      isrc: Array.isArray(common.isrc) ? common.isrc[0] || null : common.isrc || null,
      trackNumber: common.track && typeof common.track.no === 'number' ? common.track.no : null,
      addedAt: null,
      spotifyId: null,
      spotifyUrl: null,
      coverUrl: null,
      waveform: [],
      waveformBands: [],
      bpmConfidence: 0,
      keyConfidence: 0,
      camelotKey: null,
      popularity: null,
      analysisSource: common.initialKey || common.key || common.bpm ? 'tags' : 'pending'
    };
  } catch (error) {
    return {
      id: buildTrackId('local', filePath),
      source: 'local',
      availability: 'playable',
      title: fallbackTitleFromFile(filePath),
      artist: 'Unknown artist',
      album: 'Unsorted',
      duration: 0,
      bpm: null,
      key: null,
      energy: null,
      genre: null,
      tags: [],
      filePath,
      mimeType: guessMimeType(filePath),
      folderPath: path.dirname(filePath),
      fileName: path.basename(filePath),
      isrc: null,
      trackNumber: null,
      addedAt: null,
      spotifyId: null,
      spotifyUrl: null,
      coverUrl: null,
      waveform: [],
      waveformBands: [],
      bpmConfidence: 0,
      keyConfidence: 0,
      camelotKey: null,
      popularity: null,
      analysisSource: 'pending',
      scanError: error instanceof Error ? error.message : 'Metadata read failed'
    };
  }
}

function createCodeVerifier() {
  return crypto.randomBytes(64).toString('base64url');
}

function createCodeChallenge(codeVerifier) {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
}

async function spotifyFetch(url, options = {}, allowRetry = true) {
  if (!spotifySession) {
    throw new Error('Spotify is not connected.');
  }

  await ensureSpotifyAccessToken();

  const response = await fetch(url.startsWith('http') ? url : `${SPOTIFY_API_BASE}${url}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${spotifySession.accessToken}`,
      ...(options.headers || {})
    }
  });

  if (response.status === 429 && allowRetry) {
    const retryAfter = Number(response.headers.get('retry-after') || '1');
    await wait((retryAfter + 1) * 1000);
    return spotifyFetch(url, options, false);
  }

  if (response.status === 401 && spotifySession.refreshToken && allowRetry) {
    await refreshSpotifyAccessToken();
    return spotifyFetch(url, options, false);
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Spotify API error ${response.status}: ${message}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function spotifyPaginated(pathOrUrl) {
  const items = [];
  let next = pathOrUrl;

  while (next) {
    const data = await spotifyFetch(next);
    items.push(...(data.items || []));
    next = data.next;
  }

  return items;
}

async function refreshSpotifyAccessToken() {
  if (!spotifySession || !spotifySession.clientId || !spotifySession.refreshToken) {
    throw new Error('Spotify session cannot be refreshed.');
  }

  const body = new URLSearchParams({
    client_id: spotifySession.clientId,
    grant_type: 'refresh_token',
    refresh_token: spotifySession.refreshToken
  });

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Spotify token refresh failed: ${message}`);
  }

  const data = await response.json();

  spotifySession = {
    ...spotifySession,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || spotifySession.refreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000
  };
}

async function ensureSpotifyAccessToken() {
  if (!spotifySession) {
    throw new Error('Spotify is not connected.');
  }

  if (Date.now() < spotifySession.expiresAt - 60_000) {
    return;
  }

  await refreshSpotifyAccessToken();
}

async function startSpotifyAuth(clientId) {
  if (!clientId || !clientId.trim()) {
    throw new Error('Spotify Client ID is required.');
  }

  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  const state = crypto.randomUUID();
  const scope = [
    'user-library-read',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-read-private'
  ].join(' ');

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.search = new URLSearchParams({
    client_id: clientId.trim(),
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state,
    scope,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge
  }).toString();

  const authResult = await new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || '/', SPOTIFY_REDIRECT_URI);

      if (requestUrl.pathname !== '/spotify/callback') {
        response.writeHead(404);
        response.end('Not found');
        return;
      }

      if (requestUrl.searchParams.get('state') !== state) {
        response.writeHead(400, { 'content-type': 'text/html' });
        response.end('<h1>Spotify state mismatch</h1><p>You can close this window.</p>');
        server.close();
        reject(new Error('Spotify state mismatch.'));
        return;
      }

      const error = requestUrl.searchParams.get('error');
      if (error) {
        response.writeHead(400, { 'content-type': 'text/html' });
        response.end(`<h1>Spotify authorization failed</h1><p>${error}</p>`);
        server.close();
        reject(new Error(`Spotify authorization failed: ${error}`));
        return;
      }

      const code = requestUrl.searchParams.get('code');
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<h1>Spotify connected</h1><p>You can return to PEAK DJ Command.</p>');
      server.close();
      resolve({ code });
    });

    server.once('error', (error) => {
      reject(error);
    });

    server.listen(47832, '127.0.0.1', async () => {
      try {
        await shell.openExternal(authUrl.toString());
      } catch (error) {
        reject(error);
      }
    });

    setTimeout(() => {
      server.close();
      reject(new Error('Spotify authorization timed out.'));
    }, 180_000);
  });

  const tokenBody = new URLSearchParams({
    client_id: clientId.trim(),
    grant_type: 'authorization_code',
    code: authResult.code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_verifier: codeVerifier
  });

  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: tokenBody
  });

  if (!tokenResponse.ok) {
    const message = await tokenResponse.text();
    throw new Error(`Spotify token exchange failed: ${message}`);
  }

  const tokenData = await tokenResponse.json();
  spotifySession = {
    clientId: clientId.trim(),
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000
  };

  const profile = await spotifyFetch('/me');

  return {
    connected: true,
    redirectUri: SPOTIFY_REDIRECT_URI,
    profile: {
      id: profile.id,
      displayName: profile.display_name || profile.id,
      product: profile.product || 'unknown',
      imageUrl: Array.isArray(profile.images) && profile.images[0] ? profile.images[0].url : null
    }
  };
}

function mapSpotifyTrack(rawTrack, overrides = {}) {
  if (!rawTrack || !rawTrack.id) {
    return null;
  }

  return {
    id: `spotify:${rawTrack.id}`,
    source: 'spotify',
    availability: 'metadata-only',
    title: rawTrack.name || 'Unknown title',
    artist: Array.isArray(rawTrack.artists) && rawTrack.artists.length > 0
      ? rawTrack.artists.map((artist) => artist.name).join(', ')
      : 'Unknown artist',
    album: rawTrack.album?.name || 'Spotify',
    duration: Math.round((rawTrack.duration_ms || 0) / 1000),
    bpm: null,
    key: null,
    energy: null,
    genre: null,
    tags: [],
    filePath: null,
    mimeType: null,
    folderPath: null,
    fileName: null,
    isrc: rawTrack.external_ids?.isrc || null,
    trackNumber: rawTrack.track_number || null,
    addedAt: overrides.addedAt || null,
    spotifyId: rawTrack.id,
    spotifyUrl: rawTrack.external_urls?.spotify || null,
    coverUrl: rawTrack.album?.images?.[0]?.url || null,
    waveform: [],
    waveformBands: [],
    bpmConfidence: 0,
    keyConfidence: 0,
    camelotKey: null,
    popularity: typeof rawTrack.popularity === 'number' ? rawTrack.popularity : null,
    analysisSource: 'spotify'
  };
}

async function importSpotifyLibrary() {
  const profile = await spotifyFetch('/me');
  const savedItems = await spotifyPaginated('/me/tracks?limit=50');
  const playlists = await spotifyPaginated('/me/playlists?limit=50');
  const mappedSavedTracks = savedItems
    .map((item) => mapSpotifyTrack(item.track, { addedAt: item.added_at || null }))
    .filter(Boolean);

  const mappedPlaylists = [];
  for (const playlist of playlists) {
    try {
      const playlistItems = await spotifyPaginated(`/playlists/${playlist.id}/tracks?limit=100`);
      mappedPlaylists.push({
        id: `spotify-playlist:${playlist.id}`,
        name: playlist.name,
        description: playlist.description || '',
        imageUrl: Array.isArray(playlist.images) && playlist.images[0] ? playlist.images[0].url : null,
        source: 'spotify',
        trackIds: playlistItems
          .map((item) => item.track?.id)
          .filter(Boolean)
          .map((id) => `spotify:${id}`)
      });
    } catch (error) {
      mappedPlaylists.push({
        id: `spotify-playlist:${playlist.id}`,
        name: playlist.name,
        description: 'Playlist metadata imported. Track contents were unavailable for this list.',
        imageUrl: Array.isArray(playlist.images) && playlist.images[0] ? playlist.images[0].url : null,
        source: 'spotify',
        trackIds: [],
        importError: error instanceof Error ? error.message : 'Playlist read failed'
      });
    }
  }

  return {
    profile: {
      id: profile.id,
      displayName: profile.display_name || profile.id,
      product: profile.product || 'unknown',
      imageUrl: Array.isArray(profile.images) && profile.images[0] ? profile.images[0].url : null
    },
    savedTracks: mappedSavedTracks,
    playlists: mappedPlaylists
  };
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('library:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    buttonLabel: 'Scan folder'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('library:scan-folder', async (_event, folderPath) => {
  if (!folderPath) {
    throw new Error('A folder path is required to scan music.');
  }

  const files = await walkMusicFiles(folderPath);
  const tracks = [];

  for (const filePath of files) {
    tracks.push(await parseLocalTrack(filePath));
  }

  return tracks;
});

ipcMain.handle('library:read-audio-file', async (_event, filePath) => {
  const file = await fs.readFile(filePath);
  return new Uint8Array(file);
});

ipcMain.handle('shell:open-external', async (_event, url) => {
  if (url) {
    await shell.openExternal(url);
  }
});

ipcMain.handle('spotify:login', async (_event, clientId) => startSpotifyAuth(clientId));

ipcMain.handle('spotify:sync', async () => importSpotifyLibrary());

ipcMain.handle('spotify:logout', async () => {
  spotifySession = null;
  return { connected: false };
});

ipcMain.handle('spotify:redirect-uri', async () => SPOTIFY_REDIRECT_URI);

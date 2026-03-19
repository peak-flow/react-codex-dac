# PEAK DJ Command

Desktop-first DJ MVP inspired by Serato and Pioneer workflows, built with Electron, React, and TypeScript.

## What it does

- Scans a local music folder and builds a playable library from local files
- Reads local metadata such as title, artist, album, duration, tags, and any embedded BPM/key values
- Analyzes local audio to estimate waveform peaks, BPM, musical key, Camelot key, and energy
- Connects to Spotify with Authorization Code + PKCE to import liked tracks and playlists as metadata crates
- Matches Spotify imports to local files by ISRC or normalized title/artist for unified deck-ready browsing
- Provides a dual-deck DJ interface with waveform view, cue points, transport, sync, crates, search, sort, and AI-style transition suggestions

## Quick start

```bash
npm install
npm run dev
```

## Spotify setup

1. Create a Spotify app in the Spotify Developer Dashboard.
2. Add this redirect URI to the app:

```text
http://127.0.0.1:47832/spotify/callback
```

3. Paste the Spotify Client ID into the app sidebar.
4. Click `Connect`, authorize in your browser, then click `Sync Library`.

## Notes

- Spotify tracks are imported as metadata only. Deck playback is designed for local audio files or Spotify-matched local files.
- The app intentionally computes BPM/key/energy from local audio instead of assuming Spotify will provide those fields.
- This is an MVP focused on desktop workflow and metadata intelligence, not final production distribution packaging.

import type {
  Crate,
  SetArcSummary,
  SortKey,
  SourceFilter,
  SpotifyPlaylist,
  Track,
  TransitionSuggestion,
  UserTrackMeta
} from '../types';

const CAMELOT_BY_KEY: Record<string, string> = {
  Abm: '1A',
  B: '1B',
  Ebm: '2A',
  Gb: '2B',
  Bbm: '3A',
  Db: '3B',
  Fm: '4A',
  Ab: '4B',
  Cm: '5A',
  Eb: '5B',
  Gm: '6A',
  Bb: '6B',
  Dm: '7A',
  F: '7B',
  Am: '8A',
  C: '8B',
  Em: '9A',
  G: '9B',
  Bm: '10A',
  D: '10B',
  Gbm: '11A',
  A: '11B',
  Dbm: '12A',
  E: '12B'
};

const KEY_BY_CAMELOT = Object.fromEntries(
  Object.entries(CAMELOT_BY_KEY).map(([key, camelot]) => [camelot, key])
);

const SOURCE_SORT_ORDER: Record<Track['source'], number> = {
  matched: 0,
  local: 1,
  spotify: 2
};

const ENHARMONIC_MAP: Record<string, string> = {
  'C#': 'Db',
  DB: 'Db',
  'D#': 'Eb',
  EB: 'Eb',
  'F#': 'Gb',
  GB: 'Gb',
  'G#': 'Ab',
  AB: 'Ab',
  'A#': 'Bb',
  BB: 'Bb',
  CB: 'B',
  'B#': 'C',
  'E#': 'F',
  FB: 'E'
};

function normalizeText(value: string | null | undefined) {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(feat|ft|remix|edit|extended|mix|radio)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeFingerprint(title: string, artist: string) {
  return `${normalizeText(title)}::${normalizeText(artist.split(',')[0] || artist)}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function isAdjacentCamelot(left: string, right: string) {
  const leftMatch = left.match(/^(\d{1,2})([AB])$/);
  const rightMatch = right.match(/^(\d{1,2})([AB])$/);

  if (!leftMatch || !rightMatch) {
    return false;
  }

  const leftNumber = Number(leftMatch[1]);
  const rightNumber = Number(rightMatch[1]);
  const leftMode = leftMatch[2];
  const rightMode = rightMatch[2];

  const delta = Math.abs(leftNumber - rightNumber);
  const wrapped = delta === 11;

  return (delta === 1 || wrapped) && leftMode === rightMode;
}

function isRelativeCamelot(left: string, right: string) {
  const leftMatch = left.match(/^(\d{1,2})([AB])$/);
  const rightMatch = right.match(/^(\d{1,2})([AB])$/);

  if (!leftMatch || !rightMatch) {
    return false;
  }

  return leftMatch[1] === rightMatch[1] && leftMatch[2] !== rightMatch[2];
}

function safeNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeMusicalKey(input: string | null | undefined) {
  if (!input) {
    return null;
  }

  const trimmed = input.trim().replace(/♭/g, 'b').replace(/♯/g, '#');
  if (!trimmed) {
    return null;
  }

  const upper = trimmed.toUpperCase();
  if (/^\d{1,2}[AB]$/.test(upper)) {
    return KEY_BY_CAMELOT[upper] || null;
  }

  const mode = /MIN|M$/.test(upper) && !/MAJ/.test(upper) ? 'minor' : 'major';
  const noteMatch = trimmed.match(/[A-Ga-g][b#]?/);
  if (!noteMatch) {
    return null;
  }

  const rawNote = noteMatch[0]
    .replace(/b/g, 'b')
    .replace(/#/g, '#')
    .toUpperCase();

  const canonical = ENHARMONIC_MAP[rawNote] || `${rawNote[0]}${rawNote[1] === 'B' ? 'b' : rawNote[1] === '#' ? '#' : ''}`;

  if (mode === 'minor') {
    return `${canonical}m`;
  }

  return canonical;
}

export function camelotFromKey(input: string | null | undefined) {
  const normalized = normalizeMusicalKey(input);
  if (!normalized) {
    return null;
  }

  return CAMELOT_BY_KEY[normalized] || null;
}

export function formatDuration(totalSeconds: number) {
  if (!totalSeconds || totalSeconds <= 0) {
    return '--:--';
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatBpm(bpm: number | null | undefined) {
  if (typeof bpm !== 'number' || Number.isNaN(bpm)) {
    return '--';
  }

  return bpm.toFixed(1);
}

export function formatKeyLabel(track: Track | null) {
  if (!track) {
    return '--';
  }

  if (track.camelotKey && track.key) {
    return `${track.camelotKey} / ${track.key}`;
  }

  return track.camelotKey || track.key || '--';
}

export function needsAnalysis(track: Track) {
  return (
    track.availability === 'playable' &&
    (track.energy === null || track.waveform.length === 0 || track.bpm === null || track.camelotKey === null)
  );
}

export function mergeTrackLibraries(
  localTracks: Track[],
  spotifyTracks: Track[],
  spotifyPlaylists: SpotifyPlaylist[],
  localFolderPath: string | null
) {
  const unified = localTracks.map((track) => ({
    ...track,
    key: normalizeMusicalKey(track.key),
    camelotKey: camelotFromKey(track.camelotKey || track.key)
  }));

  const indexById = new Map(unified.map((track, index) => [track.id, index]));
  const indexByIsrc = new Map<string, string>();
  const indexByFingerprint = new Map<string, string>();
  const spotifyToUnified = new Map<string, string>();

  for (const track of unified) {
    if (track.isrc) {
      indexByIsrc.set(track.isrc.toLowerCase(), track.id);
    }

    indexByFingerprint.set(makeFingerprint(track.title, track.artist), track.id);
  }

  for (const spotifyTrack of spotifyTracks) {
    const byIsrc = spotifyTrack.isrc ? indexByIsrc.get(spotifyTrack.isrc.toLowerCase()) : null;
    const byFingerprint = indexByFingerprint.get(makeFingerprint(spotifyTrack.title, spotifyTrack.artist));
    const matchedId = byIsrc || byFingerprint || null;

    if (!matchedId) {
      unified.push({
        ...spotifyTrack,
        key: normalizeMusicalKey(spotifyTrack.key),
        camelotKey: camelotFromKey(spotifyTrack.camelotKey || spotifyTrack.key)
      });
      spotifyToUnified.set(spotifyTrack.id, spotifyTrack.id);
      continue;
    }

    const matchIndex = indexById.get(matchedId);
    if (matchIndex === undefined) {
      continue;
    }

    const localTrack = unified[matchIndex];
    const merged: Track = {
      ...localTrack,
      source: 'matched',
      spotifyId: spotifyTrack.spotifyId,
      spotifyUrl: spotifyTrack.spotifyUrl,
      coverUrl: localTrack.coverUrl || spotifyTrack.coverUrl,
      addedAt: spotifyTrack.addedAt || localTrack.addedAt,
      popularity: spotifyTrack.popularity,
      album: localTrack.album === 'Unsorted' ? spotifyTrack.album : localTrack.album,
      artist: localTrack.artist === 'Unknown artist' ? spotifyTrack.artist : localTrack.artist,
      title: normalizeText(localTrack.title) ? localTrack.title : spotifyTrack.title,
      genre: localTrack.genre || spotifyTrack.genre,
      tags: unique([...(localTrack.tags || []), ...(spotifyTrack.tags || [])]),
      key: normalizeMusicalKey(localTrack.key || spotifyTrack.key),
      camelotKey: camelotFromKey(localTrack.camelotKey || localTrack.key || spotifyTrack.key)
    };

    unified[matchIndex] = merged;
    spotifyToUnified.set(spotifyTrack.id, merged.id);
  }

  unified.sort((left, right) => {
    const artist = left.artist.localeCompare(right.artist);
    if (artist !== 0) {
      return artist;
    }

    return left.title.localeCompare(right.title);
  });

  const systemCrates: Crate[] = [
    {
      id: 'all',
      name: 'All Tracks',
      description: 'Everything in the unified PEAK library.',
      kind: 'collection',
      source: 'system',
      accent: 'cyan',
      trackIds: unified.map((track) => track.id)
    },
    {
      id: 'playable',
      name: 'Playable Decks',
      description: 'Local or matched tracks ready to load on a deck.',
      kind: 'collection',
      source: 'system',
      accent: 'green',
      trackIds: unified.filter((track) => track.availability === 'playable').map((track) => track.id)
    },
    {
      id: 'matched',
      name: 'Spotify Matches',
      description: 'Local files paired with Spotify playlist metadata.',
      kind: 'collection',
      source: 'system',
      accent: 'amber',
      trackIds: unified.filter((track) => track.source === 'matched').map((track) => track.id)
    },
    {
      id: 'metadata-only',
      name: 'Metadata Only',
      description: 'Spotify imports that still need a local file for deck playback.',
      kind: 'collection',
      source: 'system',
      accent: 'magenta',
      trackIds: unified.filter((track) => track.availability === 'metadata-only').map((track) => track.id)
    }
  ];

  const folderCrates: Crate[] = localFolderPath
    ? [
        {
          id: 'folder:current',
          name: localFolderPath.split('/').filter(Boolean).pop() || 'Scanned Folder',
          description: 'Tracks from the currently scanned music folder.',
          kind: 'folder',
          source: 'local',
          accent: 'cyan',
          trackIds: localTracks.map((track) => track.id)
        }
      ]
    : [];

  const spotifyCrates: Crate[] = [
    {
      id: 'spotify:saved',
      name: 'Spotify Library',
      description: 'Liked songs and saved tracks from Spotify.',
      kind: 'spotify',
      source: 'spotify',
      accent: 'green',
      trackIds: spotifyTracks.map((track) => spotifyToUnified.get(track.id) || track.id)
    },
    ...spotifyPlaylists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description || 'Imported Spotify playlist.',
      kind: 'spotify' as const,
      source: 'spotify' as const,
      accent: 'magenta',
      trackIds: playlist.trackIds.map((trackId) => spotifyToUnified.get(trackId) || trackId)
    }))
  ];

  const smartCrates: Crate[] = [
    {
      id: 'smart:warmup',
      name: 'Warm Up',
      description: 'Lower-energy openers for easing a room into motion.',
      kind: 'smart',
      source: 'ai',
      accent: 'cyan',
      trackIds: unified
        .filter((track) => (safeNumber(track.energy) ?? 40) <= 52 && (safeNumber(track.bpm) ?? 118) <= 122)
        .map((track) => track.id)
    },
    {
      id: 'smart:peak',
      name: 'Peak Pressure',
      description: 'High-energy drivers for the full-send moment.',
      kind: 'smart',
      source: 'ai',
      accent: 'amber',
      trackIds: unified
        .filter((track) => (safeNumber(track.energy) ?? 0) >= 70)
        .map((track) => track.id)
    },
    {
      id: 'smart:harmonic',
      name: 'Harmonic Ladder',
      description: 'Tracks already mapped to Camelot for smoother harmonic jumps.',
      kind: 'smart',
      source: 'ai',
      accent: 'green',
      trackIds: unified.filter((track) => Boolean(track.camelotKey)).map((track) => track.id)
    },
    {
      id: 'smart:reset',
      name: 'Reset Lane',
      description: 'Energy reset cuts to cool a room without losing control.',
      kind: 'smart',
      source: 'ai',
      accent: 'magenta',
      trackIds: unified
        .filter((track) => {
          const energy = safeNumber(track.energy) ?? 55;
          const bpm = safeNumber(track.bpm) ?? 120;
          return energy >= 38 && energy <= 62 && bpm <= 126;
        })
        .map((track) => track.id)
    }
  ];

  return {
    tracks: unified,
    crates: [...systemCrates, ...folderCrates, ...spotifyCrates, ...smartCrates].filter(
      (crate) => crate.trackIds.length > 0 || crate.id === 'all'
    )
  };
}

export function getVisibleTracks(
  tracks: Track[],
  crates: Crate[],
  selectedCrateId: string,
  searchText: string,
  sortKey: SortKey,
  sortDirection: 'asc' | 'desc',
  sourceFilter: SourceFilter,
  userTrackMeta: Map<string, UserTrackMeta>
) {
  const activeCrate = crates.find((crate) => crate.id === selectedCrateId);
  const crateSet = activeCrate ? new Set(activeCrate.trackIds) : null;
  const query = normalizeText(searchText);
  const isRemovedCrate = selectedCrateId === 'smart:removed';
  const isHistoryCrate = selectedCrateId === 'smart:history';

  const filtered = tracks.filter((track) => {
    // Hide removed tracks unless viewing the Removed crate
    if (!isRemovedCrate && userTrackMeta.get(track.id)?.removed) {
      return false;
    }

    if (crateSet && !crateSet.has(track.id)) {
      return false;
    }

    if (sourceFilter === 'playable' && track.availability !== 'playable') {
      return false;
    }

    if (sourceFilter === 'metadata-only' && track.availability !== 'metadata-only') {
      return false;
    }

    if (sourceFilter === 'local' && track.source !== 'local') {
      return false;
    }

    if (sourceFilter === 'spotify' && track.source !== 'spotify') {
      return false;
    }

    if (sourceFilter === 'matched' && track.source !== 'matched') {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = normalizeText(
      `${track.title} ${track.artist} ${track.album} ${track.genre || ''} ${(track.tags || []).join(' ')}`
    );
    return haystack.includes(query);
  });

  // History crate preserves insertion order (most recent first)
  if (isHistoryCrate && crateSet) {
    const order = activeCrate!.trackIds;
    const idToIndex = new Map(order.map((id, i) => [id, i]));
    return filtered.sort((a, b) => (idToIndex.get(a.id) ?? 999) - (idToIndex.get(b.id) ?? 999));
  }

  const sorted = [...filtered].sort((left, right) => {
    // Pinned tracks always sort to top
    const leftPinned = userTrackMeta.get(left.id)?.pinned ? 1 : 0;
    const rightPinned = userTrackMeta.get(right.id)?.pinned ? 1 : 0;
    if (leftPinned !== rightPinned) {
      return rightPinned - leftPinned;
    }

    let comparison = 0;

    switch (sortKey) {
      case 'artist':
        comparison = left.artist.localeCompare(right.artist);
        break;
      case 'album':
        comparison = left.album.localeCompare(right.album);
        break;
      case 'bpm':
        comparison = (safeNumber(left.bpm) ?? -1) - (safeNumber(right.bpm) ?? -1);
        break;
      case 'energy':
        comparison = (safeNumber(left.energy) ?? -1) - (safeNumber(right.energy) ?? -1);
        break;
      case 'duration':
        comparison = left.duration - right.duration;
        break;
      case 'source':
        comparison = SOURCE_SORT_ORDER[left.source] - SOURCE_SORT_ORDER[right.source];
        break;
      case 'title':
      default:
        comparison = left.title.localeCompare(right.title);
        break;
    }

    if (comparison === 0) {
      comparison = left.artist.localeCompare(right.artist);
    }

    return sortDirection === 'asc' ? comparison : comparison * -1;
  });

  return sorted;
}

export function scoreTransition(current: Track, candidate: Track): TransitionSuggestion {
  const bpmGap = current.bpm && candidate.bpm ? Math.abs(current.bpm - candidate.bpm) : null;
  const currentCamelot = current.camelotKey || camelotFromKey(current.key);
  const candidateCamelot = candidate.camelotKey || camelotFromKey(candidate.key);
  const currentEnergy = safeNumber(current.energy);
  const candidateEnergy = safeNumber(candidate.energy);

  let bpmScore = 18;
  if (bpmGap !== null) {
    if (bpmGap <= 2) {
      bpmScore = 34;
    } else if (bpmGap <= 5) {
      bpmScore = 28;
    } else if (bpmGap <= 8) {
      bpmScore = 18;
    } else {
      bpmScore = 8;
    }
  }

  let keyScore = 16;
  if (currentCamelot && candidateCamelot) {
    if (currentCamelot === candidateCamelot) {
      keyScore = 30;
    } else if (isAdjacentCamelot(currentCamelot, candidateCamelot)) {
      keyScore = 26;
    } else if (isRelativeCamelot(currentCamelot, candidateCamelot)) {
      keyScore = 22;
    } else {
      keyScore = 10;
    }
  }

  let energyScore = 14;
  if (currentEnergy !== null && candidateEnergy !== null) {
    const gap = candidateEnergy - currentEnergy;
    if (Math.abs(gap) <= 6) {
      energyScore = 22;
    } else if (gap > 0 && gap <= 14) {
      energyScore = 24;
    } else if (gap < 0 && Math.abs(gap) <= 14) {
      energyScore = 18;
    } else {
      energyScore = 10;
    }
  }

  const tagsOverlap = unique(
    candidate.tags.filter((tag) => current.tags.map((item) => item.toLowerCase()).includes(tag.toLowerCase()))
  ).length;
  const tagsScore = Math.min(14, tagsOverlap * 4 + (current.genre && current.genre === candidate.genre ? 6 : 0));

  const total = Math.round(bpmScore + keyScore + energyScore + tagsScore);
  const reasons = [
    bpmGap !== null ? `${bpmGap.toFixed(1)} BPM offset` : 'BPM pending analysis',
    currentCamelot && candidateCamelot ? `${currentCamelot} to ${candidateCamelot}` : 'Key pending analysis',
    currentEnergy !== null && candidateEnergy !== null
      ? `${candidateEnergy > currentEnergy ? 'Energy lift' : candidateEnergy < currentEnergy ? 'Energy reset' : 'Energy lock'}`
      : 'Energy pending analysis'
  ];

  if (candidate.source === 'matched') {
    reasons.push('Matched with Spotify metadata');
  }

  if (tagsOverlap > 0) {
    reasons.push(`${tagsOverlap} shared tag${tagsOverlap === 1 ? '' : 's'}`);
  }

  const lane =
    currentEnergy !== null && candidateEnergy !== null
      ? candidateEnergy >= currentEnergy + 8
        ? 'lift'
        : candidateEnergy <= currentEnergy - 8
          ? 'reset'
          : 'steady'
      : 'steady';

  return {
    trackId: candidate.id,
    score: total,
    lane,
    reasons,
    compatibility: {
      bpm: bpmScore,
      key: keyScore,
      energy: energyScore,
      tags: tagsScore
    }
  };
}

export function getTransitionSuggestions(referenceTrack: Track | null, tracks: Track[], excludeIds: string[]) {
  if (!referenceTrack) {
    return [];
  }

  const excluded = new Set(excludeIds);

  return tracks
    .filter((track) => track.availability === 'playable' && !excluded.has(track.id))
    .map((track) => scoreTransition(referenceTrack, track))
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);
}

export function buildMixNarrative(deckATrack: Track | null, deckBTrack: Track | null) {
  if (!deckATrack && !deckBTrack) {
    return 'Load two playable tracks and PEAK will suggest transitions, harmonic compatibility, and energy pacing.';
  }

  if (deckATrack && !deckBTrack) {
    return `Deck A is primed with ${deckATrack.title}. Load a second deck to unlock bar-level transition coaching.`;
  }

  if (!deckATrack && deckBTrack) {
    return `Deck B is live with ${deckBTrack.title}. Bring in a complementary cut to get sync and harmonic guidance.`;
  }

  if (!deckATrack || !deckBTrack) {
    return 'Load more music to continue.';
  }

  const keyHint =
    deckATrack.camelotKey && deckBTrack.camelotKey
      ? isAdjacentCamelot(deckATrack.camelotKey, deckBTrack.camelotKey) ||
        isRelativeCamelot(deckATrack.camelotKey, deckBTrack.camelotKey) ||
        deckATrack.camelotKey === deckBTrack.camelotKey
        ? 'Harmonic bridge is strong.'
        : 'Keys may clash, so use filters or a drum swap.'
      : 'Key data is still building, so trust the groove before the notation.';

  const bpmHint =
    deckATrack.bpm && deckBTrack.bpm
      ? Math.abs(deckATrack.bpm - deckBTrack.bpm) <= 2
        ? 'Tempo match is tight enough for a 16-bar blend.'
        : 'Use sync, then nudge into a shorter 8-bar handoff.'
      : 'Tempo analysis is still in progress, so line up by phrasing first.';

  const energyHint =
    deckATrack.energy !== null && deckBTrack.energy !== null
      ? deckBTrack.energy > deckATrack.energy + 10
        ? 'Incoming deck carries more voltage, so drop it after a small tension build.'
        : deckBTrack.energy < deckATrack.energy - 10
          ? 'Incoming deck cools the room nicely for a reset without emptying the floor.'
          : 'Energy is balanced, so this is a clean steady-state blend.'
      : 'Energy scoring is still settling, but the structure is ready for a smooth swap.';

  return `${keyHint} ${bpmHint} ${energyHint}`;
}

export function buildSetArcSummary(tracks: Track[]): SetArcSummary {
  const playable = tracks.filter((track) => track.availability === 'playable');
  const analyzed = playable.filter((track) => track.energy !== null && track.bpm !== null);

  if (analyzed.length === 0) {
    return {
      headline: 'Set Arc Waiting On Analysis',
      body: 'Scan a folder or run more track analysis to generate a room-energy curve.',
      recommendation: 'Start with a medium-energy crate, then let the AI smart crates sharpen as metadata fills in.'
    };
  }

  const averageEnergy = analyzed.reduce((sum, track) => sum + (track.energy || 0), 0) / analyzed.length;
  const averageBpm = analyzed.reduce((sum, track) => sum + (track.bpm || 0), 0) / analyzed.length;

  if (averageEnergy >= 70) {
    return {
      headline: 'Peak-Time Bias',
      body: `Average library energy is ${averageEnergy.toFixed(0)} with a cruising tempo around ${averageBpm.toFixed(1)} BPM.`,
      recommendation: 'Keep a reset lane nearby so the room can breathe before the next lift.'
    };
  }

  if (averageEnergy <= 48) {
    return {
      headline: 'Warm-Up DNA',
      body: `Average library energy is ${averageEnergy.toFixed(0)} and feels built for openers, day sets, or after-hours glide.`,
      recommendation: 'Build tension with harmonic lifts and save the Peak Pressure crate for later.'
    };
  }

  return {
    headline: 'Balanced Club Curve',
    body: `The collection centers around ${averageEnergy.toFixed(0)} energy and ${averageBpm.toFixed(1)} BPM, which is ideal for controlled pacing.`,
    recommendation: 'Move between Warm Up, Harmonic Ladder, and Peak Pressure crates to shape a longer narrative.'
  };
}

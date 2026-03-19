import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

interface WaveformProps {
  data: number[];
  currentTime: number;
  duration: number;
  bpm: number | null;
  cuePoints: number[];
}

const ZOOM_LEVELS = [1, 2, 4, 8, 16, 32];
const ZOOM_LABELS = ['Full', '1/2', '1/4', '8 bars', '4 bars', '2 bars'];
const DEFAULT_ZOOM_INDEX = 3; // 8 bars

function computeEightBarZoom(bpm: number | null, duration: number): number {
  if (!bpm || bpm <= 0 || duration <= 0) return 1;
  const eightBarSeconds = (60 / bpm) * 4 * 8; // 4 beats per bar * 8 bars
  if (eightBarSeconds >= duration) return 1;
  return duration / eightBarSeconds;
}

export function Waveform({ data, currentTime, duration, bpm, cuePoints }: WaveformProps) {
  const maskId = useId();
  const shellRef = useRef<HTMLDivElement>(null);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const userScrolledRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bars = data.length > 0 ? data : Array.from({ length: 180 }, (_, i) => 0.14 + Math.abs(Math.sin(i / 7)) * 0.55);

  const zoom = useMemo(() => {
    if (zoomIndex === DEFAULT_ZOOM_INDEX) {
      const dynamic = computeEightBarZoom(bpm, duration);
      return Math.max(1, dynamic);
    }
    return ZOOM_LEVELS[zoomIndex] ?? 1;
  }, [zoomIndex, bpm, duration]);

  const svgWidth = Math.round(1000 * zoom);
  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const beatMarkers = useMemo(() => {
    if (!bpm || bpm <= 0 || duration <= 0) return [];
    const barDuration = (60 / bpm) * 4; // 4 beats per bar
    const phraseLength = barDuration * 8; // 8-bar phrases
    const count = Math.ceil(duration / phraseLength);
    return Array.from({ length: count }, (_, i) => {
      const t = i * phraseLength;
      return (t / duration) * 100;
    }).filter(v => v > 0 && v < 100);
  }, [bpm, duration]);

  const barMarkers = useMemo(() => {
    if (!bpm || bpm <= 0 || duration <= 0 || zoom < 4) return [];
    const barDuration = (60 / bpm) * 4;
    const count = Math.ceil(duration / barDuration);
    return Array.from({ length: count }, (_, i) => {
      const t = i * barDuration;
      return (t / duration) * 100;
    }).filter(v => v > 0 && v < 100);
  }, [bpm, duration, zoom]);

  // Auto-scroll to keep playhead visible
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || userScrolledRef.current) return;

    const innerWidth = shell.scrollWidth;
    const viewWidth = shell.clientWidth;
    if (innerWidth <= viewWidth) return;

    const playheadX = (playheadPct / 100) * innerWidth;
    const targetScroll = playheadX - viewWidth / 2;
    shell.scrollLeft = Math.max(0, Math.min(targetScroll, innerWidth - viewWidth));
  }, [playheadPct]);

  // Detect user scroll and temporarily disable auto-scroll
  const handleScroll = useCallback(() => {
    userScrolledRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      userScrolledRef.current = false;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  const zoomIn = () => setZoomIndex(i => Math.min(ZOOM_LEVELS.length - 1, i + 1));
  const zoomOut = () => setZoomIndex(i => Math.max(0, i - 1));

  const currentLabel = ZOOM_LABELS[zoomIndex] ?? `${zoom.toFixed(1)}x`;

  return (
    <div className="waveform-outer">
      <div className="waveform-controls">
        <button className="waveform-zoom-btn" onClick={zoomOut} disabled={zoomIndex === 0} title="Zoom out">−</button>
        <span className="waveform-zoom-label">{currentLabel}</span>
        <button className="waveform-zoom-btn" onClick={zoomIn} disabled={zoomIndex === ZOOM_LEVELS.length - 1} title="Zoom in">+</button>
      </div>

      <div className="waveform-shell" ref={shellRef} onScroll={handleScroll}>
        <div className="waveform-inner" style={{ width: `${zoom * 100}%` }}>
          <svg
            className="waveform-svg"
            viewBox={`0 0 ${svgWidth} 260`}
            preserveAspectRatio="none"
            style={{ width: '100%' }}
            aria-label="Track waveform"
          >
            <defs>
              <linearGradient id={maskId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(122, 255, 138, 0.85)" />
                <stop offset="100%" stopColor="rgba(212, 225, 87, 0.88)" />
              </linearGradient>
            </defs>

            {bars.map((value, index) => {
              const width = svgWidth / bars.length;
              const centerY = 130;
              const barHeight = Math.max(12, value * 220);
              return (
                <rect
                  key={`${index}-${value}`}
                  x={index * width}
                  y={centerY - barHeight / 2}
                  width={Math.max(2, width - 1)}
                  height={barHeight}
                  rx={Math.min(width / 2, 4)}
                  fill={`url(#${maskId})`}
                  opacity={0.28 + value * 0.75}
                />
              );
            })}
          </svg>

          <div className="waveform-grid">
            {barMarkers.map((marker) => (
              <span
                key={`bar-${marker}`}
                className="waveform-marker"
                style={{ left: `${marker}%`, opacity: 0.04 }}
              />
            ))}

            {beatMarkers.map((marker) => (
              <span key={`phrase-${marker}`} className="waveform-marker" style={{ left: `${marker}%` }} />
            ))}

            {cuePoints.map((cuePoint) => (
              <span
                key={cuePoint}
                className="waveform-cue"
                style={{ left: `${duration > 0 ? (cuePoint / duration) * 100 : 0}%` }}
              />
            ))}

            <span className="waveform-playhead" style={{ left: `${playheadPct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

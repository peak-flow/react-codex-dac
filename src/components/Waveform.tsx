import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WaveformBand } from '../types';

interface WaveformProps {
  data: number[];
  bands: WaveformBand[];
  currentTime: number;
  duration: number;
  bpm: number | null;
  cuePoints: number[];
}

const ZOOM_LEVELS = [1, 2, 4, 8, 16, 32];
const ZOOM_LABELS = ['Full', '1/2', '1/4', '8 bars', '4 bars', '2 bars'];
const DEFAULT_ZOOM_INDEX = 3;

// Frequency band color map (Traktor-style rainbow)
const BAND_COLORS = {
  bass:    { r: 255, g: 68,  b: 0   }, // #ff4400
  lowMid:  { r: 255, g: 136, b: 0   }, // #ff8800
  mid:     { r: 255, g: 204, b: 0   }, // #ffcc00
  highMid: { r: 136, g: 255, b: 0   }, // #88ff00
  treble:  { r: 0,   g: 204, b: 255 }, // #00ccff
  ultra:   { r: 170, g: 102, b: 255 }, // #aa66ff
};

const FREQ_WEIGHTS = { bass: 0.38, mid: 0.37, treble: 0.25 };
const BLEND = 0.55;

function computeEightBarZoom(bpm: number | null, duration: number): number {
  if (!bpm || bpm <= 0 || duration <= 0) return 1;
  const eightBarSeconds = (60 / bpm) * 4 * 8;
  if (eightBarSeconds >= duration) return 1;
  return duration / eightBarSeconds;
}

function getBarColor(band: WaveformBand | undefined): string {
  if (!band) return 'rgba(122, 255, 138, 0.6)';

  const bands = [
    { power: band.bass * FREQ_WEIGHTS.bass,        pos: 0.0, c: BAND_COLORS.bass },
    { power: band.lowMid * FREQ_WEIGHTS.bass * 0.8, pos: 0.2, c: BAND_COLORS.lowMid },
    { power: band.mid * FREQ_WEIGHTS.mid,           pos: 0.4, c: BAND_COLORS.mid },
    { power: band.highMid * FREQ_WEIGHTS.mid * 0.8,  pos: 0.6, c: BAND_COLORS.highMid },
    { power: band.treble * FREQ_WEIGHTS.treble,      pos: 0.8, c: BAND_COLORS.treble },
    { power: band.ultra * FREQ_WEIGHTS.treble * 0.8,  pos: 1.0, c: BAND_COLORS.ultra },
  ];

  const total = bands.reduce((s, b) => s + b.power, 0);
  if (total < 0.001) return 'rgba(122, 255, 138, 0.4)';

  // Spectral centroid
  let centroid = 0;
  for (const b of bands) centroid += b.pos * (b.power / total);

  // Find surrounding bands for interpolation
  let lower = bands[0];
  let upper = bands[bands.length - 1];
  for (let j = 0; j < bands.length - 1; j++) {
    if (centroid >= bands[j].pos && centroid <= bands[j + 1].pos) {
      lower = bands[j];
      upper = bands[j + 1];
      break;
    }
  }

  const range = upper.pos - lower.pos;
  const frac = range > 0 ? (centroid - lower.pos) / range : 0;

  // Interpolated color
  const ir = lower.c.r + (upper.c.r - lower.c.r) * frac;
  const ig = lower.c.g + (upper.c.g - lower.c.g) * frac;
  const ib = lower.c.b + (upper.c.b - lower.c.b) * frac;

  // Dominant band color
  let maxP = 0;
  let dom = BAND_COLORS.bass;
  for (const b of bands) {
    if (b.power > maxP) { maxP = b.power; dom = b.c; }
  }

  // Blend between dominant and interpolated
  const r = Math.round(dom.r + (ir - dom.r) * BLEND);
  const g = Math.round(dom.g + (ig - dom.g) * BLEND);
  const b2 = Math.round(dom.b + (ib - dom.b) * BLEND);

  return `rgb(${r},${g},${b2})`;
}

export function Waveform({ data, bands, currentTime, duration, bpm, cuePoints }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const userScrolledRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasFreqData = bands.length > 0;
  const bars = data.length > 0 ? data : Array.from({ length: 180 }, (_, i) => 0.14 + Math.abs(Math.sin(i / 7)) * 0.55);

  const zoom = useMemo(() => {
    if (zoomIndex === DEFAULT_ZOOM_INDEX) {
      return Math.max(1, computeEightBarZoom(bpm, duration));
    }
    return ZOOM_LEVELS[zoomIndex] ?? 1;
  }, [zoomIndex, bpm, duration]);

  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const beatMarkers = useMemo(() => {
    if (!bpm || bpm <= 0 || duration <= 0) return [];
    const phraseLen = (60 / bpm) * 4 * 8;
    const count = Math.ceil(duration / phraseLen);
    return Array.from({ length: count }, (_, i) => ((i * phraseLen) / duration) * 100).filter(v => v > 0 && v < 100);
  }, [bpm, duration]);

  const barMarkers = useMemo(() => {
    if (!bpm || bpm <= 0 || duration <= 0 || zoom < 4) return [];
    const barDur = (60 / bpm) * 4;
    const count = Math.ceil(duration / barDur);
    return Array.from({ length: count }, (_, i) => ((i * barDur) / duration) * 100).filter(v => v > 0 && v < 100);
  }, [bpm, duration, zoom]);

  // Canvas rendering
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const shell = shellRef.current;
    if (!shell) return;

    const dpr = window.devicePixelRatio || 1;
    // Shell width × zoom = full scrollable width
    const w = shell.clientWidth * zoom;
    const h = 120;

    if (w < 1) return; // not laid out yet

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, w, h);

    const barW = 2;
    const gap = 1;
    const step = barW + gap;
    const barCount = Math.floor(w / step);
    const dataStep = bars.length / barCount;
    const centerY = h / 2;
    const maxH = centerY - 3;
    const glowIntensity = 0.35;

    // Center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(w, centerY);
    ctx.stroke();

    // Draw bars
    for (let i = 0; i < barCount; i++) {
      const di = Math.floor(i * dataStep);
      const amp = bars[Math.min(di, bars.length - 1)];
      const band = hasFreqData ? bands[Math.min(di, bands.length - 1)] : undefined;
      const barH = Math.max(2, amp * maxH);
      const x = i * step;

      const color = hasFreqData ? getBarColor(band) : 'rgba(122, 255, 138, 0.7)';

      // Glow
      if (glowIntensity > 0) {
        ctx.shadowColor = color;
        ctx.shadowBlur = glowIntensity * 8;
      }

      ctx.fillStyle = color;

      // Top half (pill-shaped = full roundness)
      const r = barW / 2;
      drawPill(ctx, x, centerY - barH, barW, barH, r);
      ctx.fill();

      // Bottom half (mirror, slightly dimmer)
      ctx.globalAlpha = 0.6;
      drawPill(ctx, x, centerY, barW, barH, r);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }
  }, [bars, bands, hasFreqData, zoom]);

  useEffect(() => {
    drawWaveform();
    const handleResize = () => drawWaveform();
    window.addEventListener('resize', handleResize);
    // Draw after a frame to ensure layout is ready
    const raf = requestAnimationFrame(drawWaveform);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(raf);
    };
  }, [drawWaveform]);

  // Auto-scroll
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

  return (
    <div className="waveform-outer">
      <div className="waveform-controls">
        <button className="waveform-zoom-btn" onClick={zoomOut} disabled={zoomIndex === 0} title="Zoom out">−</button>
        <span className="waveform-zoom-label">{ZOOM_LABELS[zoomIndex] ?? `${zoom.toFixed(1)}x`}</span>
        <button className="waveform-zoom-btn" onClick={zoomIn} disabled={zoomIndex === ZOOM_LEVELS.length - 1} title="Zoom in">+</button>
      </div>

      <div className="waveform-shell" ref={shellRef} onScroll={handleScroll}>
        <div className="waveform-inner" style={{ width: `${zoom * 100}%`, position: 'relative' }}>
          <canvas ref={canvasRef} />

          <div className="waveform-grid">
            {barMarkers.map((marker) => (
              <span key={`bar-${marker}`} className="waveform-marker" style={{ left: `${marker}%`, opacity: 0.04 }} />
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

function drawPill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

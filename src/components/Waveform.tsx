import { useId } from 'react';

interface WaveformProps {
  data: number[];
  currentTime: number;
  duration: number;
  bpm: number | null;
  cuePoints: number[];
}

export function Waveform({ data, currentTime, duration, bpm, cuePoints }: WaveformProps) {
  const maskId = useId();
  const bars = data.length > 0 ? data : Array.from({ length: 100 }, (_, index) => 0.14 + Math.abs(Math.sin(index / 7)) * 0.55);
  const playhead = duration > 0 ? (currentTime / duration) * 100 : 0;
  const beatMarkers =
    bpm && duration > 0
      ? Array.from({ length: Math.min(28, Math.ceil(duration / ((60 / bpm) * 8))) }, (_, index) => {
          const markerTime = index * (60 / bpm) * 8;
          return (markerTime / duration) * 100;
        }).filter((value) => value < 100)
      : [];

  return (
    <div className="waveform-shell">
      <svg className="waveform-svg" viewBox="0 0 1000 260" preserveAspectRatio="none" aria-label="Track waveform">
        <defs>
          <linearGradient id={maskId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(108, 255, 214, 0.85)" />
            <stop offset="100%" stopColor="rgba(255, 181, 73, 0.88)" />
          </linearGradient>
        </defs>

        {bars.map((value, index) => {
          const width = 1000 / bars.length;
          const centerY = 130;
          const barHeight = Math.max(12, value * 220);
          return (
            <rect
              key={`${index}-${value}`}
              x={index * width}
              y={centerY - barHeight / 2}
              width={Math.max(2, width - 1)}
              height={barHeight}
              rx={width / 2}
              fill={`url(#${maskId})`}
              opacity={0.28 + value * 0.75}
            />
          );
        })}
      </svg>

      <div className="waveform-grid">
        {beatMarkers.map((marker) => (
          <span key={marker} className="waveform-marker" style={{ left: `${marker}%` }} />
        ))}

        {cuePoints.map((cuePoint) => (
          <span
            key={cuePoint}
            className="waveform-cue"
            style={{ left: `${duration > 0 ? (cuePoint / duration) * 100 : 0}%` }}
          />
        ))}

        <span className="waveform-playhead" style={{ left: `${playhead}%` }} />
      </div>
    </div>
  );
}

import { camelotFromKey, normalizeMusicalKey } from './djEngine';
import type { TrackAnalysis } from '../types';

const TARGET_SAMPLE_RATE = 11025;
const BPM_WINDOW_SECONDS = 90;
const KEY_WINDOW_SECONDS = 72;
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mixdown(buffer: AudioBuffer) {
  const channelCount = buffer.numberOfChannels;
  const output = new Float32Array(buffer.length);

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = buffer.getChannelData(channelIndex);
    for (let index = 0; index < channelData.length; index += 1) {
      output[index] += channelData[index] / channelCount;
    }
  }

  return output;
}

function downsample(samples: Float32Array, inputRate: number, outputRate: number) {
  if (outputRate >= inputRate) {
    return samples;
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(samples.length / ratio);
  const output = new Float32Array(outputLength);
  let outputIndex = 0;
  let inputOffset = 0;

  while (outputIndex < outputLength) {
    const nextOffset = Math.round((outputIndex + 1) * ratio);
    let accumulator = 0;
    let count = 0;

    for (let inputIndex = Math.round(inputOffset); inputIndex < nextOffset && inputIndex < samples.length; inputIndex += 1) {
      accumulator += samples[inputIndex];
      count += 1;
    }

    output[outputIndex] = count > 0 ? accumulator / count : 0;
    outputIndex += 1;
    inputOffset = nextOffset;
  }

  return output;
}

function selectWindow(samples: Float32Array, sampleRate: number, durationSeconds: number, anchorRatio: number) {
  const targetLength = Math.min(samples.length, Math.floor(sampleRate * durationSeconds));

  if (samples.length <= targetLength) {
    return samples;
  }

  const maxStart = samples.length - targetLength;
  const start = Math.floor(maxStart * anchorRatio);
  return samples.subarray(start, start + targetLength);
}

function buildWaveform(samples: Float32Array, bucketCount: number) {
  const buckets = new Array(bucketCount).fill(0);
  const bucketSize = Math.max(1, Math.floor(samples.length / bucketCount));

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = bucketIndex * bucketSize;
    const end = Math.min(samples.length, start + bucketSize);
    let peak = 0;

    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(samples[index]));
    }

    buckets[bucketIndex] = Number(clamp(peak, 0, 1).toFixed(3));
  }

  return buckets;
}

function estimateEnergy(samples: Float32Array) {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    sum += value * value;
  }

  const rms = Math.sqrt(sum / samples.length);
  return Math.round(clamp(rms * 240, 0, 100));
}

function smooth(values: number[], radius: number) {
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;

    for (let offset = -radius; offset <= radius; offset += 1) {
      const candidate = index + offset;
      if (candidate >= 0 && candidate < values.length) {
        sum += values[candidate];
        count += 1;
      }
    }

    return count > 0 ? sum / count : 0;
  });
}

function estimateBpm(samples: Float32Array, sampleRate: number) {
  const frameSize = 1024;
  const hopSize = 256;
  const onsetEnvelope: number[] = [];
  let previousRms = 0;

  for (let start = 0; start + frameSize < samples.length; start += hopSize) {
    let energy = 0;
    for (let index = 0; index < frameSize; index += 1) {
      const value = samples[start + index];
      energy += value * value;
    }

    const rms = Math.sqrt(energy / frameSize);
    onsetEnvelope.push(Math.max(0, rms - previousRms));
    previousRms = rms;
  }

  const smoothed = smooth(onsetEnvelope, 3);
  const fps = sampleRate / hopSize;
  const minLag = Math.round((60 * fps) / 180);
  const maxLag = Math.round((60 * fps) / 70);
  let bestLag = minLag;
  let bestScore = 0;
  let secondScore = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let index = lag; index < smoothed.length; index += 1) {
      score += smoothed[index] * smoothed[index - lag];
    }

    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestLag = lag;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  let bpm = (60 * fps) / bestLag;

  if (bpm < 84) {
    bpm *= 2;
  }

  if (bpm > 170) {
    bpm /= 2;
  }

  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence: clamp(bestScore > 0 ? (bestScore - secondScore) / bestScore + 0.35 : 0, 0, 1)
  };
}

function midiToFrequency(midiNote: number) {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

function goertzelPower(
  samples: Float32Array,
  start: number,
  size: number,
  sampleRate: number,
  targetFrequency: number
) {
  const omega = (2 * Math.PI * targetFrequency) / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;

  for (let index = 0; index < size; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
    const sample = samples[start + index] * window;
    q0 = coefficient * q1 - q2 + sample;
    q2 = q1;
    q1 = q0;
  }

  return q1 * q1 + q2 * q2 - coefficient * q1 * q2;
}

function normalizeVector(values: number[]) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return values.map(() => 0);
  }

  return values.map((value) => value / magnitude);
}

function correlation(chroma: number[], profile: number[]) {
  const normalizedProfile = normalizeVector(profile);
  return chroma.reduce((sum, value, index) => sum + value * normalizedProfile[index], 0);
}

function rotateProfile(profile: number[], root: number) {
  return profile.map((_, index) => profile[(index - root + 12) % 12]);
}

function estimateKey(samples: Float32Array, sampleRate: number) {
  const workingSamples = selectWindow(samples, sampleRate, KEY_WINDOW_SECONDS, 0.24);
  const windowSize = 4096;
  const hopSize = 4096;
  const chroma = new Array(12).fill(0);
  const octaves = [48, 60, 72];

  for (let start = 0; start + windowSize < workingSamples.length; start += hopSize) {
    let frameEnergy = 0;
    for (let index = 0; index < windowSize; index += 1) {
      const value = workingSamples[start + index];
      frameEnergy += value * value;
    }

    const rms = Math.sqrt(frameEnergy / windowSize);
    if (rms < 0.02) {
      continue;
    }

    for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
      let power = 0;
      for (const octave of octaves) {
        power += goertzelPower(workingSamples, start, windowSize, sampleRate, midiToFrequency(octave + pitchClass));
      }
      chroma[pitchClass] += power;
    }
  }

  const normalizedChroma = normalizeVector(chroma);
  if (normalizedChroma.every((value) => value === 0)) {
    return {
      key: null,
      camelot: null,
      confidence: 0
    };
  }

  let bestScore = -Infinity;
  let secondScore = -Infinity;
  let bestRoot = 0;
  let bestMode: 'major' | 'minor' = 'major';

  for (let root = 0; root < 12; root += 1) {
    const majorScore = correlation(normalizedChroma, rotateProfile(MAJOR_PROFILE, root));
    if (majorScore > bestScore) {
      secondScore = bestScore;
      bestScore = majorScore;
      bestRoot = root;
      bestMode = 'major';
    } else if (majorScore > secondScore) {
      secondScore = majorScore;
    }

    const minorScore = correlation(normalizedChroma, rotateProfile(MINOR_PROFILE, root));
    if (minorScore > bestScore) {
      secondScore = bestScore;
      bestScore = minorScore;
      bestRoot = root;
      bestMode = 'minor';
    } else if (minorScore > secondScore) {
      secondScore = minorScore;
    }
  }

  const key = normalizeMusicalKey(`${NOTE_NAMES[bestRoot]}${bestMode === 'minor' ? 'm' : ''}`);
  return {
    key,
    camelot: camelotFromKey(key),
    confidence: clamp((bestScore - secondScore) / Math.max(bestScore, 0.001) + 0.32, 0, 1)
  };
}

export async function analyzeAudioFile(
  arrayBuffer: ArrayBuffer,
  audioContext: AudioContext
): Promise<TrackAnalysis> {
  const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  const mono = mixdown(decoded);
  const resampled = downsample(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
  const bpmWindow = selectWindow(resampled, TARGET_SAMPLE_RATE, BPM_WINDOW_SECONDS, 0.18);
  const bpmResult = estimateBpm(bpmWindow, TARGET_SAMPLE_RATE);
  const keyResult = estimateKey(resampled, TARGET_SAMPLE_RATE);

  return {
    bpm: bpmResult.bpm,
    bpmConfidence: bpmResult.confidence,
    key: keyResult.key,
    camelotKey: keyResult.camelot,
    keyConfidence: keyResult.confidence,
    energy: estimateEnergy(resampled),
    waveform: buildWaveform(resampled, 180),
    analysisSource: 'local-analysis'
  };
}

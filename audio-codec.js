const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 16000;

function decodeWavToFloat32(buffer) {
  const view = new DataView(buffer.buffer || buffer);
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') throw new Error('Not a WAV file');
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  let dataOffset = 44;
  for (let i = 36; i < view.byteLength - 8; i++) {
    if (view.getUint8(i) === 0x64 && view.getUint8(i + 1) === 0x61 &&
        view.getUint8(i + 2) === 0x74 && view.getUint8(i + 3) === 0x61) {
      dataOffset = i + 8;
      break;
    }
  }
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor((view.byteLength - dataOffset) / (bytesPerSample * numChannels));
  const audio = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const offset = dataOffset + i * bytesPerSample * numChannels;
    if (bitsPerSample === 16) {
      audio[i] = view.getInt16(offset, true) / 32768;
    } else if (bitsPerSample === 32) {
      audio[i] = view.getFloat32(offset, true);
    } else {
      audio[i] = (view.getUint8(offset) - 128) / 128;
    }
  }
  return { audio, sampleRate };
}

function resampleTo16k(audio, fromRate) {
  if (fromRate === SAMPLE_RATE) return audio;
  const ratio = fromRate / SAMPLE_RATE;
  const newLen = Math.round(audio.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, audio.length - 1);
    const frac = srcIdx - lo;
    result[i] = audio[lo] * (1 - frac) + audio[hi] * frac;
  }
  return result;
}

function encodeWav(float32Audio, sampleRate) {
  const numSamples = float32Audio.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, float32Audio[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return Buffer.from(buffer);
}

async function decodeAudioFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav') {
    const decoded = decodeWavToFloat32(buf);
    return resampleTo16k(decoded.audio, decoded.sampleRate);
  }
  const wavPath = filePath.replace(/\.[^.]+$/, '.wav');
  if (fs.existsSync(wavPath)) {
    const wavBuf = fs.readFileSync(wavPath);
    const decoded = decodeWavToFloat32(wavBuf);
    return resampleTo16k(decoded.audio, decoded.sampleRate);
  }
  const decode = (await import('audio-decode')).default;
  const audioBuffer = await decode(buf);
  const mono = audioBuffer.getChannelData(0);
  return resampleTo16k(mono, audioBuffer.sampleRate);
}

module.exports = { decodeWavToFloat32, resampleTo16k, encodeWav, decodeAudioFile, SAMPLE_RATE };

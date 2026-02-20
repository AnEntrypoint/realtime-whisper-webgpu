const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const GATEWAYS = [
  'https://gateway.lighthouse.storage/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
];

const TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

function downloadWithProgress(url, destination, onProgress) {
  const dir = path.dirname(destination);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let gatewayIndex = 0;
  let retryCount = 0;
  let bytesDownloaded = 0;
  let totalBytes = 0;
  let lastEmit = Date.now();
  const speeds = [];
  let lastBytes = 0;
  let lastTime = Date.now();

  function emitProgress(status) {
    if (!onProgress) return;
    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    const db = bytesDownloaded - lastBytes;
    const speed = dt > 0 ? Math.round(db / dt) : 0;
    if (speed > 0) { speeds.push(speed); if (speeds.length > 10) speeds.shift(); }
    const avgSpeed = speeds.length ? Math.round(speeds.reduce((a, b) => a + b) / speeds.length) : 0;
    lastTime = now; lastBytes = bytesDownloaded;
    onProgress({
      bytesDownloaded, totalBytes,
      bytesRemaining: Math.max(0, totalBytes - bytesDownloaded),
      percentComplete: totalBytes > 0 ? Math.round(bytesDownloaded / totalBytes * 100) : 0,
      downloadSpeed: avgSpeed,
      eta: avgSpeed > 0 && totalBytes > bytesDownloaded ? Math.round((totalBytes - bytesDownloaded) / avgSpeed) : 0,
      retryCount, status: status || 'downloading', timestamp: now,
    });
  }

  return new Promise((resolve, reject) => {
    function attempt(targetUrl) {
      emitProgress('connecting');
      const protocol = targetUrl.startsWith('https') ? https : http;
      const req = protocol.get(targetUrl, { timeout: TIMEOUT_MS }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return attempt(res.headers.location);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return tryNext(new Error(`HTTP ${res.statusCode}`));
        }
        totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        bytesDownloaded = 0; lastBytes = 0; lastTime = Date.now();
        const file = fs.createWriteStream(destination);
        res.on('data', (chunk) => {
          bytesDownloaded += chunk.length;
          if (Date.now() - lastEmit >= 200) { emitProgress(); lastEmit = Date.now(); }
        });
        res.pipe(file);
        file.on('finish', () => { emitProgress('completed'); resolve({ destination, bytesDownloaded }); });
        file.on('error', (err) => { res.destroy(); fs.unlink(destination, () => {}); tryNext(err); });
        res.on('error', (err) => { fs.unlink(destination, () => {}); tryNext(err); });
      });
      req.on('timeout', () => { req.destroy(); tryNext(new Error('timeout')); });
      req.on('error', (err) => tryNext(err));
    }

    function tryNext(err) {
      retryCount++;
      if (gatewayIndex < GATEWAYS.length - 1) {
        gatewayIndex++;
        const base = url.replace(/^https?:\/\/[^/]+\/ipfs\//, '');
        return setTimeout(() => attempt(GATEWAYS[gatewayIndex] + base), 1000 * Math.min(retryCount, 3));
      }
      if (retryCount < MAX_RETRIES) {
        gatewayIndex = 0;
        return setTimeout(() => attempt(url), 2000 * retryCount);
      }
      reject(err);
    }

    attempt(url);
  });
}

async function ensureModels(config, onProgress) {
  const { ensureModel } = require('./whisper-models');
  const { ensureTTSModels } = require('./tts-models');

  const sttModelName = config.defaultWhisperModel || 'onnx-community/whisper-base';
  const sttDir = path.join(config.modelsDir, sttModelName);
  const ttsDir = config.ttsModelsDir;

  const sttOk = fs.existsSync(sttDir) && fs.readdirSync(sttDir).length > 0;
  const ttsOk = fs.existsSync(ttsDir) && fs.readdirSync(ttsDir).length > 0;

  if (sttOk && ttsOk) return true;

  if (!sttOk) {
    if (onProgress) onProgress({ type: 'stt', status: 'downloading', done: false });
    await ensureModel(sttModelName, config);
    if (onProgress) onProgress({ type: 'stt', status: 'completed', done: true });
  }

  if (!ttsOk) {
    if (onProgress) onProgress({ type: 'tts', status: 'downloading', done: false });
    await ensureTTSModels(config);
    if (onProgress) onProgress({ type: 'tts', status: 'completed', done: true });
  }

  return true;
}

module.exports = { downloadWithProgress, ensureModels, GATEWAYS };

const fs = require('fs');
const path = require('path');
const https = require('https');
const { createDownloadLock, resolveDownloadLock, rejectDownloadLock, getDownloadPromise, isDownloading } = require('./download-lock');

const WHISPER_REQUIRED_FILES = [
  'config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged.onnx',
];

const GH_RAW_BASE = 'https://raw.githubusercontent.com/AnEntrypoint/models/main/stt/onnx-community/whisper-base/';
const GH_LFS_BASE = 'https://media.githubusercontent.com/media/AnEntrypoint/models/main/stt/onnx-community/whisper-base/';
const HF_BASE = 'https://huggingface.co/onnx-community/whisper-base/resolve/main/';

const LFS_FILES = new Set(['onnx/encoder_model.onnx', 'onnx/decoder_model_merged.onnx']);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function downloadFile(url, dest, maxRetries = 3, attempt = 0, onProgress) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const tmpDest = dest + '.tmp';
    const file = fs.createWriteStream(tmpDest);
    const cleanup = () => { try { if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest); } catch {} };
    const req = https.get(url, { headers: { 'User-Agent': 'agentgui' } }, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        file.close();
        cleanup();
        downloadFile(response.headers.location, dest, maxRetries, attempt, onProgress).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        cleanup();
        const error = new Error(`HTTP ${response.statusCode} for ${path.basename(dest)}`);
        if (attempt < maxRetries - 1) {
          setTimeout(() => downloadFile(url, dest, maxRetries, attempt + 1, onProgress).then(resolve).catch(reject), Math.pow(2, attempt) * 1000);
        } else {
          reject(error);
        }
        return;
      }
      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (onProgress) onProgress({ bytesDownloaded: downloaded, totalBytes });
      });
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        try { fs.renameSync(tmpDest, dest); resolve(); } catch (e) { cleanup(); reject(e); }
      });
    });
    req.on('error', (err) => {
      file.close();
      cleanup();
      if (attempt < maxRetries - 1) {
        setTimeout(() => downloadFile(url, dest, maxRetries, attempt + 1, onProgress).then(resolve).catch(reject), Math.pow(2, attempt) * 1000);
      } else {
        reject(err);
      }
    });
    req.setTimeout(120000, () => { req.destroy(); });
  });
}

function isFileCorrupted(filePath, minSizeBytes = null) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size === 0) return true;
    if (minSizeBytes !== null && stats.size < minSizeBytes) return true;
    if (filePath.endsWith('.json')) {
      try { JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return true; }
    }
    return false;
  } catch { return true; }
}

async function checkWhisperModelExists(modelName, config) {
  const modelDir = path.join(config.modelsDir, modelName);
  if (!fs.existsSync(modelDir)) return false;
  const requiredJson = ['config.json', 'tokenizer.json', 'preprocessor_config.json'];
  for (const f of requiredJson) {
    if (isFileCorrupted(path.join(modelDir, f))) return false;
  }
  const encoderPath = path.join(modelDir, 'onnx', 'encoder_model.onnx');
  const decoderPath = path.join(modelDir, 'onnx', 'decoder_model_merged.onnx');
  const decoderFallback = path.join(modelDir, 'onnx', 'decoder_model_merged_q4.onnx');
  const hasEncoder = fs.existsSync(encoderPath);
  const hasDecoder = fs.existsSync(decoderPath) || fs.existsSync(decoderFallback);
  if (!hasEncoder || !hasDecoder) return false;
  return !isFileCorrupted(encoderPath, 40 * 1024 * 1024) &&
    (!isFileCorrupted(decoderPath, 100 * 1024 * 1024) || !isFileCorrupted(decoderFallback, 100 * 1024 * 1024));
}

async function downloadWhisperModel(modelName, config, onProgress) {
  const modelDir = path.join(config.modelsDir, modelName);
  ensureDir(modelDir);
  const totalFiles = WHISPER_REQUIRED_FILES.length;
  let completedFiles = 0;

  for (const file of WHISPER_REQUIRED_FILES) {
    const destPath = path.join(modelDir, file);
    if (fs.existsSync(destPath) && !isFileCorrupted(destPath)) {
      completedFiles++;
      continue;
    }
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    ensureDir(path.dirname(destPath));
    console.log(`[WHISPER] Downloading ${file}...`);
    if (onProgress) {
      onProgress({ type: 'whisper', file, completedFiles, totalFiles, status: 'downloading' });
    }
    const ghUrl = LFS_FILES.has(file) ? GH_LFS_BASE + file : GH_RAW_BASE + file;
    let downloaded = false;
    try {
      await downloadFile(ghUrl, destPath, 2, 0, onProgress);
      if (!isFileCorrupted(destPath)) {
        downloaded = true;
        console.log(`[WHISPER] Downloaded ${file} from GitHub`);
      } else {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      }
    } catch (err) {
      console.warn(`[WHISPER] GitHub failed for ${file}:`, err.message);
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    }
    if (!downloaded) {
      try {
        await downloadFile(HF_BASE + file, destPath, 3, 0, onProgress);
        console.log(`[WHISPER] Downloaded ${file} from HuggingFace`);
      } catch (err2) {
        console.warn(`[WHISPER] HuggingFace also failed for ${file}:`, err2.message);
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      }
    }
    completedFiles++;
    if (onProgress) {
      onProgress({ type: 'whisper', file, completedFiles, totalFiles, status: 'completed' });
    }
  }
}

async function ensureModel(modelName, config, onProgress) {
  const lockKey = `whisper-${modelName}`;
  if (isDownloading(lockKey)) return getDownloadPromise(lockKey);
  const downloadPromise = (async () => {
    try {
      const exists = await checkWhisperModelExists(modelName, config);
      if (!exists) await downloadWhisperModel(modelName, config, onProgress);
      resolveDownloadLock(lockKey, true);
    } catch (err) {
      rejectDownloadLock(lockKey, err);
      throw err;
    }
  })();
  createDownloadLock(lockKey);
  return downloadPromise;
}

module.exports = { ensureModel, checkWhisperModelExists, downloadFile, ensureDir, isFileCorrupted };

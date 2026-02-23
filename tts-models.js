const fs = require('fs');
const path = require('path');
const { createDownloadLock, resolveDownloadLock, rejectDownloadLock, getDownloadPromise, isDownloading } = require('./download-lock');
const { ensureDir, isFileCorrupted, downloadFile } = require('./whisper-models');

const TTS_FILES = [
  { name: 'mimi_encoder.onnx', minBytes: 73 * 1024 * 1024 * 0.8 },
  { name: 'text_conditioner.onnx', minBytes: 16 * 1024 * 1024 * 0.8 },
  { name: 'flow_lm_main_int8.onnx', minBytes: 76 * 1024 * 1024 * 0.8 },
  { name: 'flow_lm_flow_int8.onnx', minBytes: 10 * 1024 * 1024 * 0.8 },
  { name: 'mimi_decoder_int8.onnx', minBytes: 23 * 1024 * 1024 * 0.8 },
  { name: 'tokenizer.model', minBytes: 59 * 1024 * 0.8 }
];

const GH_LFS_BASE = 'https://media.githubusercontent.com/media/AnEntrypoint/models/main/tts/';
const HF_TTS_BASE = 'https://huggingface.co/datasets/AnEntrypoint/sttttsmodels/resolve/main/tts/';

async function checkTTSModelExists(config) {
  const dir = config.ttsModelsDir;
  if (!fs.existsSync(dir)) return false;
  for (const file of [
    { name: 'mimi_encoder.onnx', minBytes: 73 * 1024 * 1024 * 0.8 },
    { name: 'flow_lm_main_int8.onnx', minBytes: 76 * 1024 * 1024 * 0.8 },
    { name: 'mimi_decoder_int8.onnx', minBytes: 23 * 1024 * 1024 * 0.8 }
  ]) {
    const p = path.join(dir, file.name);
    if (!fs.existsSync(p) || isFileCorrupted(p, file.minBytes)) return false;
  }
  return true;
}

async function downloadTTSModels(config, onProgress) {
  ensureDir(config.ttsModelsDir);
  const totalFiles = TTS_FILES.length;
  let completedFiles = 0;
  let totalBytes = 0;
  let downloadedBytes = 0;

  for (const file of TTS_FILES) {
    totalBytes += file.minBytes / 0.8;
  }

  for (const file of TTS_FILES) {
    const destPath = path.join(config.ttsModelsDir, file.name);
    if (fs.existsSync(destPath) && !isFileCorrupted(destPath, file.minBytes)) {
      completedFiles++;
      downloadedBytes += file.minBytes / 0.8;
      if (onProgress) {
        onProgress({ type: 'tts', file: file.name, completedFiles, totalFiles, bytesDownloaded: downloadedBytes, totalBytes, status: 'skipped' });
      }
      continue;
    }
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    ensureDir(path.dirname(destPath));
    console.log(`[TTS] Downloading ${file.name}...`);
    if (onProgress) {
      onProgress({ type: 'tts', file: file.name, completedFiles, totalFiles, bytesDownloaded: downloadedBytes, totalBytes, status: 'downloading' });
    }
    let downloaded = false;
    try {
      await downloadFile(GH_LFS_BASE + file.name, destPath, 2, 0, onProgress);
      if (!isFileCorrupted(destPath, file.minBytes)) {
        downloaded = true;
        console.log(`[TTS] Downloaded ${file.name} from GitHub`);
      } else {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      }
    } catch (err) {
      console.warn(`[TTS] GitHub failed for ${file.name}:`, err.message);
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    }
    if (!downloaded) {
      try {
        await downloadFile(HF_TTS_BASE + file.name, destPath, 3, 0, onProgress);
        console.log(`[TTS] Downloaded ${file.name} from HuggingFace`);
      } catch (err2) {
        console.warn(`[TTS] Failed to download ${file.name}:`, err2.message);
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        if (onProgress) {
          onProgress({ type: 'tts', file: file.name, completedFiles, totalFiles, bytesDownloaded: downloadedBytes, totalBytes, status: 'error', error: err2.message });
        }
        continue;
      }
    }
    completedFiles++;
    downloadedBytes += file.minBytes / 0.8;
    if (onProgress) {
      onProgress({ type: 'tts', file: file.name, completedFiles, totalFiles, bytesDownloaded: downloadedBytes, totalBytes, status: 'completed' });
    }
  }
}

async function ensureTTSModels(config, onProgress) {
  const lockKey = 'tts-models';
  if (isDownloading(lockKey)) return getDownloadPromise(lockKey);
  const downloadPromise = (async () => {
    try {
      const exists = await checkTTSModelExists(config);
      if (!exists) await downloadTTSModels(config, onProgress);
      resolveDownloadLock(lockKey, true);
    } catch (err) {
      rejectDownloadLock(lockKey, err);
      throw err;
    }
  })();
  createDownloadLock(lockKey);
  return downloadPromise;
}

module.exports = { ensureTTSModels, checkTTSModelExists };

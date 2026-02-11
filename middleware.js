const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.onnx': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.model': 'application/octet-stream'
};

const SDK_DIR = __dirname;

function webtalk(app, options = {}) {
  const mountPath = options.path || '/webtalk';
  const modelsDir = options.modelsDir || path.join(SDK_DIR, 'models');
  const { ensureModel, MODELS_DIR } = require(path.join(SDK_DIR, 'download-model'));
  const { ensureTTSModels, checkModelExists, TTS_MODEL_DIR } = require(path.join(SDK_DIR, 'download-tts-model'));
  const { patchWorker } = require(path.join(SDK_DIR, 'patch-worker'));

  // COEP/COOP headers for SharedArrayBuffer (required for ONNX threading)
  app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  });

  // TTS status API
  app.get(mountPath + '/api/tts-status', async (req, res) => {
    try {
      const exists = await checkModelExists();
      res.json({ available: exists, modelDir: TTS_MODEL_DIR });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Also mount at /api/tts-status for backward compat with existing workers
  app.get('/api/tts-status', async (req, res) => {
    try {
      const exists = await checkModelExists();
      res.json({ available: exists, modelDir: TTS_MODEL_DIR });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Serve SDK browser file
  app.get(mountPath + '/sdk.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(SDK_DIR, 'sdk.js'));
  });

  // Serve assets (workers, wasm)
  app.use('/assets', serveStatic(path.join(SDK_DIR, 'assets')));

  // Serve TTS browser files
  app.use('/tts', serveStatic(path.join(SDK_DIR, 'tts')));

  // Serve models
  app.use('/models', serveStatic(modelsDir));

  // Serve app.html demo at mount path root
  app.get(mountPath + '/demo', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.sendFile(path.join(SDK_DIR, 'app.html'));
  });

  // Serve logo and other root-level static files needed by app.html
  app.use(mountPath, serveStatic(SDK_DIR, { dotfiles: 'ignore', index: false, extensions: ['html', 'js', 'css', 'png', 'svg', 'ico'] }));

  // Return an init function for model downloads
  const init = async () => {
    try { patchWorker(); } catch (e) { console.warn('Worker patch warning:', e.message); }

    const https = require('https');
    const ortWasmFile = path.join(SDK_DIR, 'assets', 'ort-wasm-simd-threaded.jsep.wasm');
    const ortWasmUrl = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort-wasm-simd-threaded.jsep.wasm';

    if (!fs.existsSync(ortWasmFile)) {
      console.log('[webtalk] Downloading ort-wasm...');
      await downloadToFile(https, ortWasmUrl, ortWasmFile);
    }

    console.log('[webtalk] Checking Whisper models...');
    await ensureModel();

    console.log('[webtalk] Checking TTS models...');
    await ensureTTSModels();

    console.log('[webtalk] Ready');
  };

  return { init };
}

function serveStatic(root, options = {}) {
  return (req, res, next) => {
    const urlPath = decodeURIComponent(req.path || req.url);
    const filePath = path.join(root, urlPath);

    if (!filePath.startsWith(root)) {
      return res.status(403).end('Forbidden');
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) return next();
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      fs.createReadStream(filePath).pipe(res);
    });
  };
}

function downloadToFile(https, url, dest) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        return downloadToFile(https, res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

module.exports = { webtalk };

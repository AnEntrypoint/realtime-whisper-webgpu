const fs = require('fs');
const path = require('path');

const FETCH_PATCH = `const originalFetch = self.fetch;
self.fetch = function(input, init) {
  let url = typeof input === 'string' ? input : input.url;
  if (url.includes('huggingface.co') && url.includes('/resolve/main/')) {
    const match = url.match(/huggingface\\.co\\/([^\\/]+\\/[^\\/]+)\\/resolve\\/main\\/(.*)/);
    if (match) {
      const [, modelName, filePath] = match;
      return originalFetch('/models/' + modelName + '/' + filePath, init);
    }
  }
  return originalFetch(input, init);
};
`;

function patchWorker(config) {
  const workerPath = path.join(config.assetsDir, config.workerFile);
  const backupPath = path.join(config.assetsDir, config.workerBackup);

  try {
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, workerPath);
    }
    const content = fs.readFileSync(workerPath, 'utf8');
    if (content.includes('originalFetch')) return;
    fs.writeFileSync(workerPath, FETCH_PATCH + content);
  } catch (err) {}
}

module.exports = { patchWorker };

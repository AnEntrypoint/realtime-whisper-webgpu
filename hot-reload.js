const fs = require('fs');
const path = require('path');
const { getInFlightCount, setDraining, recordDrain, recordReload } = require('./persistent-state');

const DRAIN_TIMEOUT = 5000;
const DRAIN_INTERVAL = 10;
const MAX_DRAIN_INTERVAL = 100;
const WATCH_DEBOUNCE = 300;

async function drain(timeout = DRAIN_TIMEOUT) {
  recordDrain();
  setDraining(true);
  const startTime = Date.now();
  let interval = DRAIN_INTERVAL;

  while (getInFlightCount() > 0) {
    if (Date.now() - startTime > timeout) {
      setDraining(false);
      throw new Error(`Drain timeout: ${getInFlightCount()} requests still in flight`);
    }
    await new Promise(r => setTimeout(r, interval));
    interval = Math.min(interval * 2, MAX_DRAIN_INTERVAL);
  }

  setDraining(false);
}

function clearRequireCache(modules) {
  modules.forEach(moduleName => {
    const modulePath = path.resolve(moduleName.endsWith('.js') ? moduleName : moduleName + '.js');
    delete require.cache[modulePath];
    try { delete require.cache[require.resolve(modulePath)]; } catch (e) {}
  });
}

function startFileWatcher(watchedFiles, reloadCallback) {
  const watchers = [];
  let reloadTimer = null;
  let pending = false;

  const onFileChange = () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    pending = true;

    reloadTimer = setTimeout(async () => {
      if (pending) {
        pending = false;
        try {
          await reloadCallback();
        } catch (error) {
          recordReload(error);
        }
      }
    }, WATCH_DEBOUNCE);
  };

  try {
    watchedFiles.forEach(filePath => {
      const resolved = path.resolve(filePath);
      const dir = path.dirname(resolved);
      const basename = path.basename(resolved);
      const watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
        if (filename === basename) onFileChange();
      });
      watchers.push(watcher);
    });
  } catch (error) {
    recordReload(error);
  }

  return () => {
    watchers.forEach(w => { try { w.close(); } catch (e) {} });
    watchers.length = 0;
    if (reloadTimer) clearTimeout(reloadTimer);
  };
}

module.exports = { drain, clearRequireCache, startFileWatcher };

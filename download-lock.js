const locks = new Map();
const promises = new Map();

function createDownloadLock(key) {
  if (locks.has(key)) return promises.get(key);
  const promise = new Promise((resolve, reject) => {
    locks.set(key, { resolve, reject });
  });
  promises.set(key, promise);
  return promise;
}

function resolveDownloadLock(key, value) {
  const lock = locks.get(key);
  if (lock) { lock.resolve(value); locks.delete(key); promises.delete(key); }
}

function rejectDownloadLock(key, error) {
  const lock = locks.get(key);
  if (lock) { lock.reject(error); locks.delete(key); promises.delete(key); }
}

function getDownloadPromise(key) { return promises.get(key); }
function isDownloading(key) { return promises.has(key); }

module.exports = { createDownloadLock, resolveDownloadLock, rejectDownloadLock, getDownloadPromise, isDownloading };

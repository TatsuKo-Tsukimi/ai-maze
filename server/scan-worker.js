'use strict';

const { parentPort, workerData } = require('worker_threads');
const { fullScan } = require('./file-scanner');

try {
  const result = fullScan(
    [workerData.soulPath],
    { excludePaths: [workerData.gameDir] }
  );
  // Only send paths — avoid serializing full objects across thread boundary
  parentPort.postMessage({
    ok: true,
    imagePaths: result.images.map(f => f.path),
    textPaths: result.textFiles.map(f => f.path),
    scanTime: result.scanTime,
  });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err.message });
}

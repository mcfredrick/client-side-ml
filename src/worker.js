import { ONNXHTDemucs } from 'demucs/dist/onnx-htdemucs.js';
import { separateTracks } from 'demucs/dist/apply.js';
import { samplesToWav } from 'demucs/dist/wav-utils.js';

console.log('[worker] Worker started.');

let modelPromise = null;

async function getModel() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    self.postMessage({ type: 'status', text: 'Downloading model (~170 MB, cached after first use)...' });
    console.log('[worker] Checking model cache...');

    const cache = await caches.open('demucs-model-v1');
    // Fetch from GitHub Releases (GitHub Pages can't serve Git LFS files)
    const modelUrl = 'https://github.com/mcfredrick/client-side-ml/releases/download/v0.1.0/htdemucs.onnx';
    const MIN_MODEL_SIZE = 100 * 1024 * 1024; // 100 MB — real model is ~166 MB

    let response = await cache.match(modelUrl);
    if (response) {
      const cachedSize = parseInt(response.headers.get('content-length') || '0', 10);
      if (cachedSize > MIN_MODEL_SIZE) {
        console.log(`[worker] Model found in cache (${(cachedSize / 1024 / 1024).toFixed(0)} MB).`);
      } else {
        console.log(`[worker] Cached model too small (${cachedSize} bytes), re-downloading...`);
        await cache.delete(modelUrl);
        response = null;
      }
    }

    if (!response) {
      console.log('[worker] Downloading model...');
      const t0 = performance.now();
      response = await fetch(modelUrl);
      if (!response.ok) {
        throw new Error(`Model download failed: HTTP ${response.status}`);
      }
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`[worker] Model downloaded in ${elapsed}s, caching...`);
      await cache.put(modelUrl, response.clone());
    }

    console.log('[worker] Reading model weights into ArrayBuffer...');
    const weights = await response.arrayBuffer();
    console.log(`[worker] Model weights: ${(weights.byteLength / 1024 / 1024).toFixed(1)} MB`);

    self.postMessage({ type: 'status', text: 'Initializing ONNX Runtime session...' });
    console.log('[worker] Initializing ONNXHTDemucs...');
    const t0 = performance.now();
    const model = await ONNXHTDemucs.init(weights);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`[worker] Model initialized in ${elapsed}s. Execution providers requested: [webgpu, wasm]`);
    return model;
  })();
  return modelPromise;
}

self.onmessage = async (e) => {
  if (e.data.type !== 'separate') return;

  console.log('[worker] Received audio for separation:', {
    channels: e.data.rawAudio.channelData.length,
    sampleRate: e.data.rawAudio.sampleRate,
    samples: e.data.rawAudio.channelData[0].length,
    duration: `${(e.data.rawAudio.channelData[0].length / e.data.rawAudio.sampleRate).toFixed(1)}s`,
  });

  try {
    const model = await getModel();

    self.postMessage({ type: 'status', text: 'Separating stems...' });
    console.log('[worker] Starting stem separation...');
    const t0 = performance.now();

    const tracks = await separateTracks(
      model,
      e.data.rawAudio,
      (step, total) => {
        console.log(`[worker] Progress: ${step}/${total}`);
        self.postMessage({ type: 'progress', step, total });
      },
    );

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`[worker] Separation complete in ${elapsed}s. Stems:`, Object.keys(tracks));

    // Encode each stem as WAV
    console.log('[worker] Encoding stems as WAV...');
    const results = {};
    for (const [name, audio] of Object.entries(tracks)) {
      const wav = samplesToWav(audio.channelData, audio.sampleRate);
      results[name] = wav.buffer;
      console.log(`[worker]   ${name}: ${(wav.byteLength / 1024 / 1024).toFixed(1)} MB`);
    }

    self.postMessage(
      { type: 'done', tracks: results },
      Object.values(results),
    );
    console.log('[worker] Results sent to main thread.');
  } catch (err) {
    console.error('[worker] Error:', err);
    self.postMessage({ type: 'error', message: err.message });
  }
};

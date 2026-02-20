# Client-Side ML: Demucs Stem Separation

Browser-based audio stem separation using [HTDemucs v4](https://github.com/facebookresearch/demucs) and [ONNX Runtime Web](https://onnxruntime.ai/). All inference runs client-side — no server required.

Separates audio into 4 stems: **drums**, **bass**, **vocals**, **other**.

## Prerequisites

- Node.js 18+
- npm

## Quick Start

```bash
npm install
npm run build
./serve.sh
```

Open http://localhost:8080 in Chrome or Edge (WebGPU gives best performance; Firefox works via WASM fallback).

## Project Structure

```
src/
  index.html                  # UI: file drop zone, progress bar, audio players
  main.js                     # Main thread: audio decoding, worker communication
  worker.js                   # Web Worker: model loading, ONNX inference
  coi-serviceworker.min.js    # Enables SharedArrayBuffer on static hosts

build.mjs                     # esbuild bundler config
serve.sh                      # Local dev server script
docs/                         # Build output (served as static site)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Bundle source and copy assets to `docs/` |
| `npm run serve` | Start local HTTP server on port 8080 |
| `./serve.sh` | Same as above, with options (see below) |
| `./serve.sh 3000` | Serve on custom port |
| `./serve.sh 8080 server.log` | Serve with logs written to file |

## How It Works

1. User selects an audio file (wav, mp3, m4a, ogg, flac)
2. Main thread decodes audio to 44.1 kHz raw PCM via Web Audio API
3. Audio is transferred to a Web Worker (zero-copy via transferable buffers)
4. Worker downloads and caches the `htdemucs.onnx` model (~170 MB) on first use
5. The `demucs` npm package runs HTDemucs v4 inference through ONNX Runtime Web
6. ONNX Runtime uses WebGPU if available, falls back to multi-threaded WASM
7. 4 separated stems are encoded as WAV and sent back to the main thread
8. Audio players and download links are rendered for each stem

### Key Dependencies

| Package | Role |
|---------|------|
| [`demucs`](https://www.npmjs.com/package/demucs) | HTDemucs v4 implementation (STFT, chunked inference, overlap-add) |
| [`onnxruntime-web`](https://www.npmjs.com/package/onnxruntime-web) | ONNX model inference (WebGPU + WASM backends) |
| [`esbuild`](https://esbuild.github.io/) | Bundler (aliases `onnxruntime-node` to `onnxruntime-web` for browser use) |

### Build Details

`build.mjs` does the following:

1. Bundles `src/worker.js` with all dependencies (demucs + onnxruntime-web) into a single file, aliasing `onnxruntime-node` to `onnxruntime-web`
2. Bundles `src/main.js` (no external dependencies)
3. Copies static assets: `index.html`, `coi-serviceworker.min.js`
4. Copies ONNX Runtime WASM files from `node_modules/onnxruntime-web/dist/`
5. Copies the `htdemucs.onnx` model from `node_modules/demucs/`

### Browser Compatibility

| Browser | Backend | Notes |
|---------|---------|-------|
| Chrome/Edge 113+ | WebGPU | Best performance (~3x realtime) |
| Safari 26+ | WebGPU | Untested |
| Firefox | WASM | WebGPU behind flag; WASM is slower but functional |
| Older browsers | WASM (single-thread) | Works if SharedArrayBuffer unavailable |

## Deploying to GitHub Pages

The `docs/` directory is a complete static site. The challenge is the large files:

- `htdemucs.onnx` — 166 MB (ONNX model weights)
- `ort-wasm-simd-threaded.jsep.wasm` — 24 MB
- `ort-wasm-simd-threaded.wasm` — 12 MB

These exceed GitHub's 100 MB file size limit for normal git commits. Three options:

### Option A: Git LFS (simplest)

Track large files with Git Large File Storage:

```bash
# Install Git LFS if needed
brew install git-lfs
git lfs install

# Track the large files
git lfs track "docs/htdemucs.onnx"
git lfs track "docs/*.wasm"

# Remove them from .gitignore (they were excluded by default)
# Edit .gitignore to remove the docs/htdemucs.onnx and docs/*.wasm lines

# Commit and push
git add .gitattributes docs/
git commit -m "Add build output with LFS for large files"
git push
```

Then in your repo settings, configure GitHub Pages to serve from the `docs/` folder on your branch.

**Note:** GitHub LFS has a free tier of 1 GB storage and 1 GB/month bandwidth. Each page visitor downloads the model once (then it's cached in the browser), so bandwidth depends on unique visitors.

### Option B: Host Models on HuggingFace (best for bandwidth)

Upload the model to a HuggingFace repository and fetch it at runtime:

1. Create a HuggingFace repo and upload `htdemucs.onnx`
2. Update the model URL in `src/worker.js`:

```js
// Change this:
const modelUrl = './htdemucs.onnx';

// To this:
const modelUrl = 'https://huggingface.co/YOUR_USER/YOUR_REPO/resolve/main/htdemucs.onnx';
```

3. Rebuild with `npm run build`
4. The WASM files (24 MB + 12 MB) are under GitHub's limit and can be committed normally
5. Remove `docs/*.wasm` from `.gitignore`, commit, and push

### Option C: CDN (jsDelivr)

The model is included in the `demucs` npm package, so jsDelivr can serve it:

```js
const modelUrl = 'https://cdn.jsdelivr.net/npm/demucs@1.0.0/htdemucs.onnx';
```

This relies on jsDelivr's availability and may be slower for the initial download.

### Cross-Origin Isolation

GitHub Pages doesn't support custom HTTP headers. The `coi-serviceworker.min.js` script handles this by intercepting requests via a Service Worker to add the `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers needed for `SharedArrayBuffer` (used by multi-threaded WASM). This is already included in the build — no extra configuration needed.

On first visit, the service worker registers and reloads the page once. Subsequent visits load normally.

## Adding a Custom Classification Model

The project uses ONNX Runtime Web for Demucs inference. You can run additional ONNX models in the same worker with minimal changes. Here's how to add a drum transcription classifier that processes the drums stem output from Demucs.

### Step 1: Convert Your Model to ONNX

From PyTorch:

```python
import torch

model = YourClassifier()
model.load_state_dict(torch.load("classifier.pt"))
model.eval()

# Create a dummy input matching your model's expected shape
# For example, if your model expects a spectrogram of shape [1, n_bins, n_frames]:
dummy_input = torch.randn(1, 128, 256)

torch.onnx.export(
    model,
    dummy_input,
    "drum_classifier.onnx",
    opset_version=17,
    input_names=["input"],
    output_names=["output"],
    dynamic_axes={
        "input": {2: "n_frames"},   # allow variable-length input
        "output": {1: "n_frames"},
    },
)
```

From TensorFlow/Keras, use [tf2onnx](https://github.com/onnx/tensorflow-onnx):

```bash
python -m tf2onnx.convert --saved-model ./saved_model --output drum_classifier.onnx --opset 17
```

### Step 2: Add the Model to the Build

Place your ONNX model in `src/` and update `build.mjs` to copy it:

```js
// Copy your custom classifier model
cpSync(join(__dirname, 'src/drum_classifier.onnx'), join(outdir, 'drum_classifier.onnx'));
```

### Step 3: Load and Run in the Worker

Update `src/worker.js` to load the classifier alongside Demucs and run inference on the drums stem:

```js
import { ONNXHTDemucs } from 'demucs/dist/onnx-htdemucs.js';
import { separateTracks } from 'demucs/dist/apply.js';
import { samplesToWav } from 'demucs/dist/wav-utils.js';
import * as ort from 'onnxruntime-web';

let modelPromise = null;
let classifierPromise = null;

// ... existing getModel() for Demucs ...

async function getClassifier() {
  if (classifierPromise) return classifierPromise;
  classifierPromise = (async () => {
    console.log('[worker] Loading drum classifier...');

    const cache = await caches.open('classifier-model-v1');
    const url = './drum_classifier.onnx';
    let response = await cache.match(url);
    if (!response) {
      response = await fetch(url);
      await cache.put(url, response.clone());
    }
    const weights = await response.arrayBuffer();

    // Use the same execution providers as Demucs
    const session = await ort.InferenceSession.create(weights, {
      executionProviders: ['webgpu', 'wasm'],
    });
    console.log('[worker] Classifier ready. Inputs:', session.inputNames, 'Outputs:', session.outputNames);
    return session;
  })();
  return classifierPromise;
}

self.onmessage = async (e) => {
  if (e.data.type !== 'separate') return;

  try {
    const model = await getModel();
    const classifier = await getClassifier();

    // 1. Separate stems
    const tracks = await separateTracks(model, e.data.rawAudio, (step, total) => {
      self.postMessage({ type: 'progress', step, total });
    });

    // 2. Run classifier on the drums stem
    const drums = tracks.drums;
    // Prepare input — adapt this to your model's expected format.
    // drums.channelData is Float32Array[] (one per channel), drums.sampleRate is 44100.
    // If your model expects raw waveform:
    const inputTensor = new ort.Tensor('float32', drums.channelData[0], [1, 1, drums.channelData[0].length]);
    // If your model expects a spectrogram, compute it here from the raw audio.

    const classifierResults = await classifier.run({ input: inputTensor });
    const output = classifierResults.output;
    console.log('[worker] Classifier output shape:', output.dims, 'data:', output.data.slice(0, 10));

    // 3. Send everything back
    const wavResults = {};
    for (const [name, audio] of Object.entries(tracks)) {
      const wav = samplesToWav(audio.channelData, audio.sampleRate);
      wavResults[name] = wav.buffer;
    }

    self.postMessage(
      {
        type: 'done',
        tracks: wavResults,
        transcription: { dims: Array.from(output.dims), data: Array.from(output.data) },
      },
      Object.values(wavResults),
    );
  } catch (err) {
    console.error('[worker] Error:', err);
    self.postMessage({ type: 'error', message: err.message });
  }
};
```

### Step 4: Handle Results in the Main Thread

Update `src/main.js` to handle the transcription data alongside the audio stems:

```js
if (msg.type === 'done') {
  // ... existing stem rendering code ...

  if (msg.transcription) {
    console.log('[main] Transcription:', msg.transcription);
    // Render your transcription results in the UI
  }
}
```

### Key Points

- **Same ONNX Runtime instance**: The classifier shares the same `onnxruntime-web` already bundled for Demucs. No extra dependencies.
- **Same execution providers**: WebGPU if available, WASM fallback. Both models benefit from GPU acceleration.
- **Cache API**: Each model is cached separately in the browser so repeat visits are fast.
- **Input format**: Adapt the input tensor creation to match what your classifier expects (raw waveform, spectrogram, mel spectrogram, etc.). If you need FFT/spectrogram computation, the `demucs` package's `dsp.js` module exports STFT functions you can reuse.
- **Model size**: Keep your classifier model small if possible. Quantize to float16 or int8 using [ONNX Runtime's optimization tools](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html) to reduce download size and improve inference speed.

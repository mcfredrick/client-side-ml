import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outdir = join(__dirname, 'docs');

mkdirSync(outdir, { recursive: true });

// Bundle the web worker — alias onnxruntime-node to onnxruntime-web
// No format specified (defaults to iife) to match classic Worker loading
await esbuild.build({
  entryPoints: [join(__dirname, 'src/worker.js')],
  bundle: true,
  outfile: join(outdir, 'worker.js'),
  alias: { 'onnxruntime-node': 'onnxruntime-web' },
  define: { 'process.env.NODE_ENV': '"production"' },
});

// Bundle main thread code
await esbuild.build({
  entryPoints: [join(__dirname, 'src/main.js')],
  bundle: true,
  outfile: join(outdir, 'main.js'),
});

// Copy static assets
cpSync(join(__dirname, 'src/index.html'), join(outdir, 'index.html'));
cpSync(join(__dirname, 'src/coi-serviceworker.min.js'), join(outdir, 'coi-serviceworker.min.js'));

// Copy ONNX Runtime WASM files (needed at runtime)
const ortDist = join(__dirname, 'node_modules/onnxruntime-web/dist');
for (const file of [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.mjs',
]) {
  cpSync(join(ortDist, file), join(outdir, file));
}

// Copy the Demucs ONNX model
cpSync(
  join(__dirname, 'node_modules/demucs/htdemucs.onnx'),
  join(outdir, 'htdemucs.onnx'),
);

console.log('Build complete. Output in docs/');
console.log('Run: npx http-server docs -p 8080 --cors -c-1');

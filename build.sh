#!/usr/bin/env bash
# Build script — compiles WASM, bundles TypeScript with esbuild.
set -e
cd "$(dirname "$0")"

# 1. Compile Rust to WASM (only if source changed)
. "$HOME/.cargo/env"
(cd wasm && cargo build --release --target wasm32-unknown-unknown)

# 2. Generate wasm-bindgen JS glue (web target)
mkdir -p dist/wasm
wasm-bindgen --target web --out-dir dist/wasm --no-typescript \
  wasm/target/wasm32-unknown-unknown/release/backrooms_wasm.wasm

# 3. Bundle TypeScript + three.js into a single dist/main.js
npx esbuild src/main.ts \
  --bundle \
  --format=esm \
  --target=es2020 \
  --loader:.wasm=file \
  --outfile=dist/main.js \
  --minify \
  --sourcemap

echo "Build complete."
echo "  - dist/main.js"
echo "  - dist/wasm/backrooms_wasm.js"
echo "  - dist/wasm/backrooms_wasm_bg.wasm"
ls -la dist/ dist/wasm/

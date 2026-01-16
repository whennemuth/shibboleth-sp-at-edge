const esbuild = require('esbuild');
const { execSync } = require('child_process');

// Step 1: Run TypeScript compiler to generate type definitions
execSync('tsc');

// Step 2: Use esbuild to bundle JavaScript files

// Build for ESM
esbuild.build({
  entryPoints: ['bin/build/index.ts'],
  bundle: true,
  outdir: 'dist/esm',
  format: 'esm',
  platform: 'node',
  tsconfig: 'tsconfig.json',
  sourcemap: true,
}).catch(() => process.exit(1));

// Build for CJS
esbuild.build({
  entryPoints: ['bin/build/index.ts'],
  bundle: true,
  outdir: 'dist/cjs',
  format: 'cjs',
  platform: 'node',
  tsconfig: 'tsconfig.json',
  sourcemap: true
}).catch(() => process.exit(1));
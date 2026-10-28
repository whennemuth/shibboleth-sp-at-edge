const fs = require('fs');
const esbuild = require('esbuild');
const { execSync } = require('child_process');

// Windows-safe clean (rm -rf wouldn't be).
fs.rmSync('dist', { recursive: true, force: true });
fs.rmSync('build', { recursive: true, force: true });

// Compile the construct library: per-file CommonJS, declarations and inline source maps,
// to dist/cjs and dist/types (see tsconfig.json). Not bundled - lib/EdgeFunction*.ts locate
// the edge bundles below via __dirname relative to this compiled output.
// stdio defaults to 'pipe' (not 'inherit'): some terminal/CI wrappers mishandle a nested
// process inheriting a non-tty stdout, so output is captured and printed explicitly instead.
try {
  const output = execSync('tsc -p tsconfig.json');
  if (output.length) process.stdout.write(output);
} catch (err) {
  if (err.stdout) process.stdout.write(err.stdout);
  if (err.stderr) process.stderr.write(err.stderr);
  process.exit(1);
}

// Bundle the three Lambda@Edge functions. Node 22 provides the AWS SDK v3, so it's external.
// shibboleth-sp is aliased to its CommonJS build: its "exports" map would otherwise send an
// `import` reference (used in FunctionSpOriginRequest.ts) to its ESM build, which calls
// createRequire(import.meta.url) - undefined once bundled into a CommonJS file.
const edgeFunctionBuild = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  alias: { 'shibboleth-sp': require.resolve('shibboleth-sp') },
  external: ['@aws-sdk/*'],
};

Promise.all([
  esbuild.build({
    ...edgeFunctionBuild,
    entryPoints: ['lib/lambda/FunctionSpViewerRequest.ts'],
    outfile: 'build/edge-viewer-request.js',
  }),
  esbuild.build({
    ...edgeFunctionBuild,
    entryPoints: ['lib/lambda/FunctionSpOriginRequest.ts'],
    outfile: 'build/edge-origin-request.js',
  }),
  esbuild.build({
    ...edgeFunctionBuild,
    entryPoints: ['lib/lambda/FunctionSpViewerResponse.ts'],
    outfile: 'build/edge-viewer-response.js',
  }),
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
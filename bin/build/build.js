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
// edge-context.json is also external: it doesn't exist at build time (the construct writes it
// alongside the bundle at synth time, see lib/EdgeContext.ts), and esbuild preserves an external
// relative require() path verbatim, which still resolves correctly once both land in build/.
const edgeFunctionBuild = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  alias: { 'shibboleth-sp': require.resolve('shibboleth-sp') },
  external: ['@aws-sdk/*', './edge-context.json'],
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
]).then(() => {
  // Guard against ever re-inlining context: these two bundles (the only ones that read
  // SHIBBOLETH config) must require() it externally, not carry literal values of their own.
  for (const file of ['build/edge-viewer-request.js', 'build/edge-origin-request.js']) {
    const contents = fs.readFileSync(file, 'utf8');
    if (!contents.includes('require("./edge-context.json")')) {
      console.error(`${file} does not require("./edge-context.json") - the edge-context external was lost.`);
      process.exit(1);
    }
    if (contents.includes('context/context.json')) {
      console.error(`${file} still references context/context.json directly - it should import ./EdgeContext instead.`);
      process.exit(1);
    }
  }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
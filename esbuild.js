const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Copy KaTeX runtime assets (CSS + fonts) into media/ so the WebView can load
 * them locally — no CDN (NFR-005). Kept out of git; regenerated on every build. */
function copyKatexAssets() {
  const src = path.dirname(require.resolve('katex/package.json'));
  const dest = path.join(__dirname, 'media', 'vendor', 'katex');
  fs.mkdirSync(path.join(dest, 'fonts'), { recursive: true });
  fs.copyFileSync(path.join(src, 'dist', 'katex.min.css'), path.join(dest, 'katex.min.css'));
  for (const font of fs.readdirSync(path.join(src, 'dist', 'fonts'))) {
    // woff2 is supported by every VS Code build; skip the legacy ttf/woff twins.
    if (font.endsWith('.woff2')) {
      fs.copyFileSync(path.join(src, 'dist', 'fonts', font), path.join(dest, 'fonts', font));
    }
  }
}

/** Shared plugin to surface build problems in the watch terminal. */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => console.log('[build] started'));
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}`);
        }
      });
      console.log('[build] finished');
    });
  },
};

/** Extension host bundle (Node / CommonJS). */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'silent',
  plugins: [problemMatcherPlugin],
};

/** WebView bundle (browser / IIFE) — mermaid is bundled locally, no CDN. */
const webviewConfig = {
  entryPoints: ['media/preview.src.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'media/preview.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'silent',
  plugins: [problemMatcherPlugin],
};

async function main() {
  copyKatexAssets();
  if (watch) {
    const ctxExt = await esbuild.context(extensionConfig);
    const ctxWeb = await esbuild.context(webviewConfig);
    await Promise.all([ctxExt.watch(), ctxWeb.watch()]);
    console.log('[watch] watching extension + webview bundles...');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log('[build] extension + webview bundles complete');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

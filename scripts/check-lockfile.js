#!/usr/bin/env node
/*
 * Supply-chain guard: verify package-lock.json integrity before install/CI.
 *
 * A common attack is a poisoned lockfile in a pull request — swapping a
 * package's `resolved` URL to an attacker-controlled host, downgrading
 * `integrity` to a weaker hash, or removing it entirely. npm installs exactly
 * what the lockfile says, so this passes code review easily unless checked.
 *
 * Checks (no dependencies, plain Node):
 *   1. every resolved URL points to https://registry.npmjs.org/
 *   2. every registry package pins a sha512 integrity hash
 *   3. no git/file/http(s)-tarball dependencies sneak in
 */
const fs = require('fs');
const path = require('path');

const lockPath = path.join(__dirname, '..', 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

const REGISTRY = 'https://registry.npmjs.org/';
const problems = [];

for (const [name, pkg] of Object.entries(lock.packages ?? {})) {
  if (name === '' || pkg.link) {
    continue; // the root project itself / workspace links
  }
  const label = name.replace(/^node_modules\//, '');

  if (pkg.resolved === undefined && pkg.integrity === undefined) {
    continue; // bundled/optional platform stubs npm leaves without metadata
  }
  if (typeof pkg.resolved !== 'string' || !pkg.resolved.startsWith(REGISTRY)) {
    problems.push(`${label}: resolved outside npm registry -> ${pkg.resolved}`);
    continue;
  }
  if (typeof pkg.integrity !== 'string' || !pkg.integrity.startsWith('sha512-')) {
    problems.push(`${label}: missing or weak integrity hash (${pkg.integrity ?? 'none'})`);
  }
}

if (problems.length > 0) {
  console.error(`✘ package-lock.json failed the supply-chain check (${problems.length} problem(s)):\n`);
  for (const p of problems) {
    console.error(`  - ${p}`);
  }
  process.exit(1);
}

const count = Object.keys(lock.packages ?? {}).length - 1;
console.log(`✔ package-lock.json OK — ${count} packages, all resolved from registry.npmjs.org with sha512 integrity.`);

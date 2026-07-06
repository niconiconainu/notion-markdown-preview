#!/usr/bin/env node
/*
 * Print the CHANGELOG.md section for one version (used by the release
 * workflow to fill the GitHub Release body).
 *
 *   node scripts/release-notes.js 0.11.0
 */
const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version) {
  console.error('usage: node scripts/release-notes.js <version>');
  process.exit(1);
}

const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const lines = changelog.split('\n');

const isHeading = (line) => /^## \[/.test(line);
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`No "## [${version}]" section found in CHANGELOG.md`);
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (isHeading(lines[i])) {
    end = i;
    break;
  }
}

const body = lines.slice(start + 1, end).join('\n').trim();
if (body.length === 0) {
  console.error(`The "## [${version}]" section in CHANGELOG.md is empty`);
  process.exit(1);
}
console.log(body);

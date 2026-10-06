import { readFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const lock = read('package-lock.json');
const market = read('.claude-plugin/marketplace.json');

const declared = {
  '.claude-plugin/plugin.json': read('.claude-plugin/plugin.json').version,
  '.claude-plugin/marketplace.json (plugins[0])': market.plugins?.[0]?.version,
  'package.json': read('package.json').version,
  'package-lock.json (root)': lock.version,
  'package-lock.json (packages[""])': lock.packages?.['']?.version,
};

const versions = new Set(Object.values(declared));
if (versions.size !== 1 || versions.has(undefined)) {
  console.error('Version mismatch: every declared version must be equal.');
  for (const [file, version] of Object.entries(declared)) console.error(`  ${file}: ${version}`);
  process.exit(1);
}
console.log(`All declared versions are ${[...versions][0]}.`);

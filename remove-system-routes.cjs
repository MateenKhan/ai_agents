const fs = require('fs');
const lines = fs.readFileSync('db/server.ts', 'utf8').split('\n');

// Find the start index for // ── system status
const startIdx = lines.findIndex(l => l.includes('// ── system status ── one poll for the UI'));
const endIdx = lines.findIndex(l => l.includes('// ── Datastore backend ──'));

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not find indices: ', startIdx, endIdx);
  process.exit(1);
}

// Remove those lines
lines.splice(startIdx, endIdx - startIdx);

fs.writeFileSync('db/server.ts', lines.join('\n'), 'utf8');
console.log('Removed system status routes.');

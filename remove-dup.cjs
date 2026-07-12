const fs = require('fs');
let lines = fs.readFileSync('db/server.ts', 'utf8').split('\n');

// Delete lines 3373 to 3459 (0-indexed 3372 to 3458)
lines.splice(3372, 87); // 3459 - 3372 = 87 lines

fs.writeFileSync('db/server.ts', lines.join('\n'), 'utf8');
console.log('Removed duplicated block.');

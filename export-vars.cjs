const fs = require('fs');

let content = fs.readFileSync('db/server.ts', 'utf8');

const varsToExport = [
  'projectIdOf',
  'getHeartbeat',
  'getCodeIndexConfig',
  'projectRepoPath',
  'systemActivity',
  'isRebuilding',
  'ACTIVE_AGENTS',
  'getBoardSettings',
  'getAllTasks',
  'getRecentLogs',
  'boardCorrupt'
];

for (const v of varsToExport) {
  // Regex to match start of line, optional spaces, and the declaration (const, let, var, function, async function)
  const regex = new RegExp(`^(\\s*)(async function|function|const|let|var)\\s+(${v})\\b`, 'gm');
  content = content.replace(regex, (match, spaces, decl, name) => {
    // Only add export if not already exported
    if (spaces.includes('export')) return match;
    return `${spaces}export ${decl} ${name}`;
  });
}

fs.writeFileSync('db/server.ts', content, 'utf8');
console.log('Exports added.');

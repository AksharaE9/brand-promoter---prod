const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../frontend/src');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else {
      results.push(fullPath);
    }
  });
  return results;
}

const files = walk(srcDir);
let failed = false;

files.forEach(filePath => {
  // Ignore non-JS/TS/JSX/TSX files
  if (!/\.(js|ts|jsx|tsx)$/.test(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    // 1. Literal /api/api
    if (line.includes('/api/api')) {
      console.error(`❌ Doubled /api/api found in ${filePath}:${index + 1}:`);
      console.error(`   ${line.trim()}`);
      failed = true;
    }
    // 2. `${API_BASE_URL}/api` or `${API_BASE_URL}/api/`
    if (/\$\{API_BASE_URL\}\/api/.test(line)) {
      console.error(`❌ Hardcoded /api subpath on API_BASE_URL found in ${filePath}:${index + 1}:`);
      console.error(`   ${line.trim()}`);
      failed = true;
    }
    // 3. buildApiUrl('/api') or buildApiUrl('/api/')
    if (/buildApiUrl\(['"`]\/api/.test(line)) {
      console.error(`❌ Path starting with /api passed to buildApiUrl in ${filePath}:${index + 1}:`);
      console.error(`   ${line.trim()}`);
      failed = true;
    }
  });
});

if (failed) {
  console.error('\n💥 Build failed due to doubled /api/api pattern validation check.');
  process.exit(1);
} else {
  console.log('✅ Doubled /api pattern check passed.');
  process.exit(0);
}

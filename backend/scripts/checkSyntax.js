'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function checkDirectory(dir) {
  let errors = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      errors += checkDirectory(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      try {
        execSync(`node -c "${fullPath}"`, { stdio: 'pipe' });
      } catch (err) {
        console.error(`[SyntaxError] File failed syntax check: ${fullPath}`);
        console.error(err.stderr ? err.stderr.toString() : err.message);
        errors++;
      }
    }
  }
  return errors;
}

const srcDir = path.resolve(__dirname, '../src');
console.log(`[CheckSyntax] Validating JS syntax in ${srcDir}...`);
const totalErrors = checkDirectory(srcDir);

if (totalErrors > 0) {
  console.error(`[CheckSyntax] FAILED: ${totalErrors} syntax error(s) found! Deployment aborted.`);
  process.exit(1);
} else {
  console.log('[CheckSyntax] SUCCESS: All backend source files parse cleanly.');
}

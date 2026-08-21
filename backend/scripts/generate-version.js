'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetPath = path.join(__dirname, '..', 'src', 'version.json');

let commit = process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || 'unknown';
let deployedAt = new Date().toISOString();

if (commit === 'unknown') {
  try {
    commit = execSync('git rev-parse --short HEAD').toString().trim();
  } catch (err) {
    commit = 'unknown';
  }
} else {
  // Ensure it's short SHA (7 characters)
  commit = commit.substring(0, 7);
}

const versionData = {
  commit,
  deployedAt
};

try {
  fs.writeFileSync(targetPath, JSON.stringify(versionData, null, 2), 'utf8');
  console.log(`✅ Generated version.json at ${targetPath}:`, JSON.stringify(versionData));
} catch (err) {
  console.error('❌ Failed to generate version.json:', err.message);
}

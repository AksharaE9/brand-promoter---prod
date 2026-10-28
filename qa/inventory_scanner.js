'use strict';

const fs = require('fs');
const path = require('path');

function scanBackendRoutes() {
  const routes = [];
  const appPath = path.resolve(__dirname, '../backend/src/app.js');
  const appCode = fs.readFileSync(appPath, 'utf8');

  // Look for app.use mounts
  const mountRegex = /app\.(?:use|get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = mountRegex.exec(appCode)) !== null) {
    routes.push(match[1]);
  }
  return Array.from(new Set(routes));
}

function scanBackgroundWorkers() {
  const jobsDir = path.resolve(__dirname, '../backend/src/jobs');
  if (!fs.existsSync(jobsDir)) return [];
  return fs.readdirSync(jobsDir).filter(f => f.endsWith('.js'));
}

function checkRecentBuilds() {
  const builds = {
    'Resume Parsing & JD Scoring': {
      routesFile: 'backend/src/modules/matching/routes.js',
      schemaModel: 'parsed_resumes',
      status: 'Implemented'
    },
    'External API & API Keys': {
      routesFile: 'backend/src/modules/ext/routes.js',
      schemaModel: 'api_keys',
      status: 'Implemented'
    },
    'HireIQ Feed': {
      routesFile: 'backend/src/modules/ext/routes.js',
      schemaModel: 'api_keys',
      status: 'Implemented'
    },
    'Recruit AI Results Sync': {
      routesFile: 'backend/src/modules/integrations/recruit-ai/routes.js',
      schemaModel: 'external_assessment_results',
      status: 'Implemented'
    },
    'Telecalling Team Sync Fix': {
      routesFile: 'backend/src/modules/scheduling/routes.js',
      status: 'Implemented'
    },
    'Session Expiry & Error Classification': {
      routesFile: 'backend/src/middleware/error-handler.js',
      status: 'Implemented'
    },
    'Drive Bulk-Upload Fix': {
      routesFile: 'backend/src/routes/bulkUpload.js',
      status: 'Implemented'
    },
    'Follow-up Upload Fix': {
      routesFile: 'backend/src/modules/files/routes.js',
      status: 'Implemented'
    },
    'BCA/MCA & City Exports': {
      routesFile: 'backend/scripts/export_bca_mca_hold_rejected.js',
      status: 'Implemented'
    }
  };

  Object.entries(builds).forEach(([name, meta]) => {
    const fullPath = path.resolve(__dirname, '..', meta.routesFile);
    meta.exists = fs.existsSync(fullPath);
  });

  return builds;
}

const backendRoutes = scanBackendRoutes();
const workers = scanBackgroundWorkers();
const builds = checkRecentBuilds();

console.log('=== FEATURE INVENTORY SUMMARY ===');
console.log('Backend Top-level Mounts:', backendRoutes.length);
console.log('Background Workers:', workers);
console.log('\nRecent Builds Verification:');
console.dir(builds, { depth: null });

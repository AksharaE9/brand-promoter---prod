// qa/profile_boot_and_heap.js
const v8 = require('v8');
const path = require('path');
require(path.resolve(__dirname, '../backend/node_modules/dotenv')).config({ path: path.resolve(__dirname, '../backend/.env') });

function formatMb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

console.log('=== MEMORY & HEAP DIAGNOSIS AT BOOT ===');

const initialMemory = process.memoryUsage();
console.log('Bare Node process memory:');
console.log('  RSS:', formatMb(initialMemory.rss));
console.log('  Heap Used:', formatMb(initialMemory.heapUsed));
console.log('  Heap Total:', formatMb(initialMemory.heapTotal));

console.log('\nLoading backend app modules (Express, Prisma, Routes)...');
const t0 = Date.now();
// Require backend/src/app
const { app } = require(path.resolve(__dirname, '../backend/src/app'));
const loadTime = Date.now() - t0;

const postLoadMemory = process.memoryUsage();
console.log(`\nApp loaded in ${loadTime} ms`);
console.log('Memory after loading all routes:');
console.log('  RSS:', formatMb(postLoadMemory.rss), `(+${formatMb(postLoadMemory.rss - initialMemory.rss)})`);
console.log('  Heap Used:', formatMb(postLoadMemory.heapUsed), `(+${formatMb(postLoadMemory.heapUsed - initialMemory.heapUsed)})`);
console.log('  Heap Total:', formatMb(postLoadMemory.heapTotal));

// Analyze require.cache to see top heavyweight packages
const cachedModules = Object.keys(require.cache);
console.log(`\nTotal modules in require.cache: ${cachedModules.length}`);

const packageCounts = {};
for (const modPath of cachedModules) {
  const parts = modPath.split(path.sep);
  const nmIndex = parts.lastIndexOf('node_modules');
  if (nmIndex !== -1 && nmIndex + 1 < parts.length) {
    let pkg = parts[nmIndex + 1];
    if (pkg.startsWith('@') && nmIndex + 2 < parts.length) {
      pkg = `${pkg}/${parts[nmIndex + 2]}`;
    }
    packageCounts[pkg] = (packageCounts[pkg] || 0) + 1;
  }
}

const sortedPackages = Object.entries(packageCounts).sort((a, b) => b[1] - a[1]);
console.log('\nTop packages by file count in require.cache:');
console.table(sortedPackages.slice(0, 15).map(([pkg, count]) => ({ Package: pkg, FileCount: count })));

// Check for heavy libraries loaded at boot:
const heavyLibs = ['xlsx', 'pdf-parse', 'mammoth', 'exceljs', 'pdfkit', 'bcryptjs', 'bcrypt'];
console.log('\nHeavy libraries loaded eagerly at boot:');
heavyLibs.forEach(lib => {
  const isLoaded = cachedModules.some(m => m.includes(path.sep + lib + path.sep));
  console.log(`  ${lib}: ${isLoaded ? 'YES (EAGERLY LOADED AT BOOT)' : 'NO'}`);
});

// Take a heap space statistics snapshot
console.log('\nV8 Heap Space Statistics:');
console.table(v8.getHeapSpaceStatistics().map(s => ({
  space_name: s.space_name,
  space_size: formatMb(s.space_size),
  space_used_size: formatMb(s.space_used_size),
  space_available_size: formatMb(s.space_available_size)
})));

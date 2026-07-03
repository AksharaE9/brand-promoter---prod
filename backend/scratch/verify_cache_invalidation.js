const l1 = require('../src/utils/l1Cache');
const inv = require('../src/utils/cacheInvalidation');

const cacheKey = 'interviews:list:defaultOrg:abc';
l1.set(cacheKey, { some: 'data' }, 30000);
console.log('Before invalidation, key exists:', l1.get(cacheKey) !== null);

inv.interview('defaultOrg').then(() => {
  // Give background setImmediate a moment to execute
  setTimeout(() => {
    console.log('After invalidation, key exists:', l1.get(cacheKey) !== null);
    process.exit(0);
  }, 100);
});

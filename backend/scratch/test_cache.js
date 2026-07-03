const l1 = require('../src/utils/l1Cache');

l1.set('users:list:defaultOrg:all', { test: true }, 60000);
console.log('Initially set:', l1.get('users:list:defaultOrg:all'));

// Simulate deleteCachePattern('users:list:defaultOrg:*')
const pattern = 'users:list:defaultOrg:*';
const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
console.log('Prefix in cache.js:', prefix);

l1.deletePattern(prefix);
console.log('After delete:', l1.get('users:list:defaultOrg:all'));

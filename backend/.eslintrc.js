module.exports = {
  env: {
    node: true,
    es2021: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'commonjs',
  },
  rules: {
    'no-unused-vars': 'off',
    'no-console': 'off',
    'no-process-exit': 'off',
    'no-empty': 'off',
  },
  ignorePatterns: [
    'node_modules/',
    'prisma/',
    '*.test.js',
    'tests/',
    'scratch*',
    'check_*.js',
    'cleanup_*.js',
    'list_*.js',
    'get_*.js',
    'flush_*.js',
    'stats.js',
    'test-*.js',
    'test_*.js',
    'scripts/bootstrap-admin.js',
  ],
};

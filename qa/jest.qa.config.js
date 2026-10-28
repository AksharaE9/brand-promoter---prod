'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '..',
  testMatch: [
    '<rootDir>/qa/tests/**/*.test.js'
  ],
  testTimeout: 15000,
  verbose: true,
  maxWorkers: 1,
  forceExit: true
};

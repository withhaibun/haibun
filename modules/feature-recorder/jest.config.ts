/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['node_modules', 'build'],
  globals: {
    'testMatch': [
    "<rootDir>/build/**/*.test.ts"
  ]
  }
};

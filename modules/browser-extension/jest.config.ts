/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testPathIgnorePatterns: ['node_modules', 'build', 'dist/js'],
  //  isolatedModules: true,
  globals: {
    'testMatch': [
      "<rootDir>/src/**/*.test.ts"
    ]
  }
};


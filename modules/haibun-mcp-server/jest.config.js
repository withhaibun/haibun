module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Optional: setupFilesAfterEnv: ['./tests/setupTests.ts'], // If you need global setup
  moduleNameMapper: {
    // Handle Haibun's internal .js extensions if tests try to import them directly without extension
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // If Haibun uses path aliases, map them here, e.g.:
    // "^@haibun/core/(.*)$": "<rootDir>/../../core/src/$1" 
    // For now, assuming direct relative paths or node_modules resolution works for built files.
  },
  // Automatically clear mock calls and instances between every test
  clearMocks: true,
};

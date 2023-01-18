const config = {
  testEnvironment: 'jsdom',
  roots: [
    '<rootDir>/dist/js'
  ],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)'
  ],
  transform: {},
}

export default config;


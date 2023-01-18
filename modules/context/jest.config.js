import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  roots: [
    '<rootDir>/build'
  ],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)'
  ],
  transform: {},
}

export default config;
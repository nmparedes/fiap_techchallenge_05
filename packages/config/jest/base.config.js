/** @type {import('jest').Config} */
export const baseJestConfig = {
  clearMocks: true,
  restoreMocks: true,
  coverageDirectory: '<rootDir>/coverage',
  coverageProvider: 'v8',
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  collectCoverageFrom: [
    '<rootDir>/**/src/**/*.{js,jsx,ts,tsx}',
    '!<rootDir>/**/src/**/*.d.ts',
    '!<rootDir>/**/src/**/types/**',
    '!<rootDir>/**/src/**/generated/**',
    '!<rootDir>/**/src/**/migrations/**',
    '!<rootDir>/**/src/**/*.config.{js,jsx,ts,tsx}',
    '!<rootDir>/**/src/main.{js,jsx,ts,tsx}',
    '!<rootDir>/src/index.{js,jsx,ts,tsx}',
    '!<rootDir>/**/src/**/*.{test,spec}.{js,jsx,ts,tsx}',
    '!<rootDir>/**/src/**/__tests__/**',
  ],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['<rootDir>/**/?(*.)+(spec|test).[jt]s?(x)'],
  transform: {
    '^.+\\.tsx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: {
            syntax: 'typescript',
            tsx: true,
          },
          target: 'es2022',
        },
        module: {
          type: 'es6',
        },
      },
    ],
  },
};

/**
 * Creates a Jest configuration for a specific runtime environment.
 *
 * @param {'node' | 'jsdom'} testEnvironment
 * @param {import('jest').Config} [overrides]
 * @returns {import('jest').Config}
 */
export function createJestConfig(testEnvironment, overrides = {}) {
  return {
    ...baseJestConfig,
    testEnvironment,
    ...overrides,
  };
}

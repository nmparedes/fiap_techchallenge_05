import { describe, expect, it } from '@jest/globals';

import { baseJestConfig, jsdomJestConfig, nodeJestConfig } from '../index.js';

describe('shared Jest configuration', () => {
  it('uses the required environments and coverage policy', () => {
    expect(nodeJestConfig.testEnvironment).toBe('node');
    expect(jsdomJestConfig.testEnvironment).toBe('jsdom');
    expect(baseJestConfig.coverageProvider).toBe('v8');
    expect(baseJestConfig.coverageThreshold).toEqual({
      global: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    });
    expect(import.meta.url).toContain('jest-configuration.test.ts');
  });
});

import { createJestConfig } from './base.config.js';

export const jsdomJestConfig = createJestConfig('jsdom', {
  testEnvironmentOptions: {
    url: 'http://localhost/',
  },
});

export default jsdomJestConfig;

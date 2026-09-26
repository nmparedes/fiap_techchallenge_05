import jsdomJestConfig from '../../packages/config/jest/jsdom.config.js';

export default {
  ...jsdomJestConfig,
  displayName: 'frontend',
  rootDir: import.meta.dirname,
};

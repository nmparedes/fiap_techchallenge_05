import nodeJestConfig from '../config/jest/node.config.js';

export default {
  ...nodeJestConfig,
  displayName: 'test-utils',
  rootDir: import.meta.dirname,
};

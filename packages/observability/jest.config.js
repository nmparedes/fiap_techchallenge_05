import nodeJestConfig from '../config/jest/node.config.js';

export default {
  ...nodeJestConfig,
  displayName: 'observability',
  rootDir: import.meta.dirname,
};

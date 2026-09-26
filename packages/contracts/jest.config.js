import nodeJestConfig from '../config/jest/node.config.js';

export default {
  ...nodeJestConfig,
  displayName: 'contracts',
  rootDir: import.meta.dirname,
};

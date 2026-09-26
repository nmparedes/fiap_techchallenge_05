import nodeJestConfig from './jest/node.config.js';

export default {
  ...nodeJestConfig,
  displayName: 'config',
  rootDir: import.meta.dirname,
};

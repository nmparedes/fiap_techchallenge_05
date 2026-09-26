import nodeJestConfig from './packages/config/jest/node.config.js';

export default {
  ...nodeJestConfig,
  displayName: 'fiap-x',
  rootDir: import.meta.dirname,
};

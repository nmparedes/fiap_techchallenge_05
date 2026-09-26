import nodeJestConfig from '../../packages/config/jest/node.config.js';

export default {
  ...nodeJestConfig,
  displayName: 'auth-service',
  rootDir: import.meta.dirname,
};

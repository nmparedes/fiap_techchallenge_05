import nodeJestConfig from '../../packages/config/jest/node.config.js';

export default {
  ...nodeJestConfig,
  displayName: 'processor-service',
  rootDir: import.meta.dirname,
};

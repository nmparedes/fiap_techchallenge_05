import nodeJestConfig from '../../packages/config/jest/node.config.js';

export default {
  ...nodeJestConfig,
  displayName: 'notification-service',
  rootDir: import.meta.dirname,
};

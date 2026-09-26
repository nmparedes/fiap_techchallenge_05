import nodeJestConfig from '../../packages/config/jest/node.config.js';

export default {
  ...nodeJestConfig,
  displayName: 'video-service',
  rootDir: import.meta.dirname,
};

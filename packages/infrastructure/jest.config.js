import nodeJestConfig from '../config/jest/node.config.js';

export default {
  ...nodeJestConfig,
  displayName: 'infrastructure',
  rootDir: import.meta.dirname,
  collectCoverageFrom: [...(nodeJestConfig.collectCoverageFrom ?? []), '!<rootDir>/src/cli/**'],
};

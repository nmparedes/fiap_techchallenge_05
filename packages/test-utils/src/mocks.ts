import { jest } from '@jest/globals';

type MockableFunction = (...arguments_: never[]) => unknown;

export function createMock<T extends MockableFunction>() {
  return jest.fn<T>();
}

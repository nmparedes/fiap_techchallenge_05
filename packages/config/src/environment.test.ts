import { describe, expect, it } from '@jest/globals';

import {
  EnvironmentValidationError,
  readEnvironmentBoolean,
  readEnvironmentInteger,
  readEnvironmentString,
} from './environment.js';

describe('environment configuration', () => {
  it('reads required strings without changing their value', () => {
    expect(readEnvironmentString('API_KEY', { API_KEY: '  secret value  ' })).toBe(
      '  secret value  ',
    );
  });

  it('rejects missing and blank strings without exposing a value', () => {
    expect(() => readEnvironmentString('API_KEY', {})).toThrow(EnvironmentValidationError);
    expect(() => readEnvironmentString('API_KEY', { API_KEY: '   ' })).toThrow(
      'Invalid environment variable API_KEY: a non-empty value is required',
    );
  });

  it('reads safe integers within explicit boundaries', () => {
    expect(readEnvironmentInteger('PORT', { PORT: '3000' })).toBe(3000);
    expect(readEnvironmentInteger('PORT', { PORT: '3000' }, { minimum: 1, maximum: 65_535 })).toBe(
      3000,
    );
  });

  it.each([
    [{ PORT: '3.5' }, {}, 'an integer is required'],
    [{ PORT: '9007199254740992' }, {}, 'a safe integer is required'],
    [{ PORT: '0' }, { minimum: 1 }, 'must be at least 1'],
    [{ PORT: '65536' }, { maximum: 65_535 }, 'must be at most 65535'],
  ] as const)('rejects invalid integers', (environment, options, message) => {
    expect(() => readEnvironmentInteger('PORT', environment, options)).toThrow(message);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ] as const)('reads the supported boolean value %s', (rawValue, expected) => {
    expect(readEnvironmentBoolean('ENABLED', { ENABLED: rawValue })).toBe(expected);
  });

  it('rejects ambiguous boolean values', () => {
    expect(() => readEnvironmentBoolean('ENABLED', { ENABLED: 'yes' })).toThrow(
      'Invalid environment variable ENABLED: true, false, 1, or 0 is required',
    );
  });
});

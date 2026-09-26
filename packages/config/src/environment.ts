export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface IntegerEnvironmentOptions {
  minimum?: number;
  maximum?: number;
}

export class EnvironmentValidationError extends Error {
  public constructor(variableName: string, reason: string) {
    super(`Invalid environment variable ${variableName}: ${reason}`);
    this.name = 'EnvironmentValidationError';
  }
}

export function readEnvironmentString(
  variableName: string,
  environment: EnvironmentSource = process.env,
): string {
  const value = environment[variableName];

  if (value === undefined || value.trim().length === 0) {
    throw new EnvironmentValidationError(variableName, 'a non-empty value is required');
  }

  return value;
}

export function readEnvironmentInteger(
  variableName: string,
  environment: EnvironmentSource = process.env,
  options: IntegerEnvironmentOptions = {},
): number {
  const rawValue = readEnvironmentString(variableName, environment);

  if (!/^-?\d+$/.test(rawValue)) {
    throw new EnvironmentValidationError(variableName, 'an integer is required');
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value)) {
    throw new EnvironmentValidationError(variableName, 'a safe integer is required');
  }

  if (options.minimum !== undefined && value < options.minimum) {
    throw new EnvironmentValidationError(variableName, `must be at least ${options.minimum}`);
  }

  if (options.maximum !== undefined && value > options.maximum) {
    throw new EnvironmentValidationError(variableName, `must be at most ${options.maximum}`);
  }

  return value;
}

export function readEnvironmentBoolean(
  variableName: string,
  environment: EnvironmentSource = process.env,
): boolean {
  const value = readEnvironmentString(variableName, environment).toLowerCase();

  if (value === 'true' || value === '1') {
    return true;
  }

  if (value === 'false' || value === '0') {
    return false;
  }

  throw new EnvironmentValidationError(variableName, 'true, false, 1, or 0 is required');
}

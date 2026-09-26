const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeUuid(value: string, fieldName: string): string {
  if (!uuidPattern.test(value)) {
    throw new TypeError(`${fieldName} must be a valid UUID`);
  }

  return value.toLowerCase();
}

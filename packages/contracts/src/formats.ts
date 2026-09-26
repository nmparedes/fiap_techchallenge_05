import { FormatRegistry } from '@sinclair/typebox';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function registerContractFormats(): void {
  if (!FormatRegistry.Has('uuid')) {
    FormatRegistry.Set('uuid', (value) => uuidPattern.test(value));
  }

  if (!FormatRegistry.Has('date-time')) {
    FormatRegistry.Set(
      'date-time',
      (value) => dateTimePattern.test(value) && !Number.isNaN(Date.parse(value)),
    );
  }
}

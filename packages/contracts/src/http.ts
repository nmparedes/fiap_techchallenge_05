import { Type, type Static, type TSchema } from '@sinclair/typebox';

export function createHttpSuccessSchema<TData extends TSchema>(dataSchema: TData) {
  return Type.Object(
    {
      success: Type.Literal(true),
      data: dataSchema,
    },
    { additionalProperties: false },
  );
}

export const HttpSuccessResponseSchema = createHttpSuccessSchema(Type.Unknown());

export type HttpSuccessResponse = Static<typeof HttpSuccessResponseSchema>;

export const HttpErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    details: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const HttpErrorResponseSchema = Type.Object(
  {
    success: Type.Literal(false),
    error: HttpErrorSchema,
  },
  { additionalProperties: false },
);

export type HttpError = Static<typeof HttpErrorSchema>;
export type HttpErrorResponse = Static<typeof HttpErrorResponseSchema>;

import { Type, type Static } from '@sinclair/typebox';

import { IdentifierSchema } from './common.js';
import { createHttpSuccessSchema } from './http.js';

export const AuthUsernameSchema = Type.String({
  minLength: 3,
  maxLength: 64,
});

export const LoginRequestSchema = Type.Object(
  {
    username: AuthUsernameSchema,
    password: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

export type LoginRequest = Static<typeof LoginRequestSchema>;

export const AuthenticatedUserSchema = Type.Object(
  {
    id: IdentifierSchema,
    username: AuthUsernameSchema,
    displayName: Type.String({ minLength: 1, maxLength: 120 }),
  },
  { additionalProperties: false },
);

export type AuthenticatedUser = Static<typeof AuthenticatedUserSchema>;

export const AuthTokenClaimsSchema = Type.Object(
  {
    sub: IdentifierSchema,
    username: AuthUsernameSchema,
    iss: Type.String({ minLength: 1 }),
    aud: Type.Union([
      Type.String({ minLength: 1 }),
      Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    ]),
    iat: Type.Integer({ minimum: 0 }),
    exp: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type AuthTokenClaims = Static<typeof AuthTokenClaimsSchema>;

export const LoginResponseDataSchema = Type.Object(
  {
    accessToken: Type.String({ minLength: 1 }),
    tokenType: Type.Literal('Bearer'),
    expiresIn: Type.Integer({ minimum: 1 }),
    user: AuthenticatedUserSchema,
  },
  { additionalProperties: false },
);

export const LoginResponseSchema = createHttpSuccessSchema(LoginResponseDataSchema);
export type LoginResponse = Static<typeof LoginResponseSchema>;

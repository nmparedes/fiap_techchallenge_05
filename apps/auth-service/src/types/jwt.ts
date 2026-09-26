export interface AuthTokenPayload {
  sub: string;
  username: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthTokenPayload;
    user: AuthTokenPayload;
  }
}

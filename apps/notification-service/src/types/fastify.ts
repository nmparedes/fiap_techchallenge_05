export interface AuthenticatedRequestUser {
  id: string;
  username: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthenticatedRequestUser | undefined;
  }
}

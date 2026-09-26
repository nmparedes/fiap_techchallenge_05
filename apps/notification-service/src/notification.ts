import {
  IdentifierSchema,
  ProcessingErrorCodeSchema,
  TimestampSchema,
  createHttpSuccessSchema,
} from '@fiap-x/contracts';
import { Type, type Static } from '@sinclair/typebox';

export interface NotificationPaginationOptions {
  defaultPageSize: number;
  maximumPageSize: number;
}

export function createNotificationListQuerySchema(options: NotificationPaginationOptions) {
  return Type.Object(
    {
      page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
      pageSize: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: options.maximumPageSize,
          default: options.defaultPageSize,
        }),
      ),
    },
    { additionalProperties: false },
  );
}

export interface NotificationListQuery {
  page?: number;
  pageSize?: number;
}

export const NotificationViewSchema = Type.Object(
  {
    id: IdentifierSchema,
    videoId: IdentifierSchema,
    attempt: Type.Integer({ minimum: 1 }),
    errorCode: ProcessingErrorCodeSchema,
    message: Type.String({ minLength: 1 }),
    createdAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export type NotificationView = Static<typeof NotificationViewSchema>;

export const NotificationPageSchema = Type.Object(
  {
    items: Type.Array(NotificationViewSchema),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const NotificationListResponseSchema = createHttpSuccessSchema(NotificationPageSchema);
export type NotificationPage = Static<typeof NotificationPageSchema>;

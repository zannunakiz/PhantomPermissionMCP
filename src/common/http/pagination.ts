import { z } from 'zod';

export const API_V1_PREFIX = 'api/v1';
export const PAGINATION_DEFAULT_PAGE = 1;
export const PAGINATION_DEFAULT_PAGE_SIZE = 20;
export const PAGINATION_MAX_PAGE_SIZE = 100;

export const paginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(PAGINATION_DEFAULT_PAGE),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(PAGINATION_MAX_PAGE_SIZE)
      .default(PAGINATION_DEFAULT_PAGE_SIZE),
  })
  .strict();

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type PageMeta = {
  page: number;
  pageSize: number;
  total: number;
};
export type PagedResult<T> = { data: readonly T[]; page: PageMeta };

export function paginate<T>(
  items: readonly T[],
  query: PaginationQuery,
): PagedResult<T> {
  const total = items.length;
  const start = (query.page - 1) * query.pageSize;
  return {
    data: items.slice(start, start + query.pageSize),
    page: { page: query.page, pageSize: query.pageSize, total },
  };
}

export function toISOString(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

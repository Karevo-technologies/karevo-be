import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** `?cursor=&limit=` on every list endpoint. The cursor is the last item's id. */
export class CursorQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit: number = DEFAULT_LIMIT;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/** Prisma args for keyset pagination: fetch one extra row to know if there is a next page. */
export function pageArgs(q: CursorQueryDto) {
  return {
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  };
}

export function toPage<R extends { id: string }, T>(rows: R[], limit: number, map: (r: R) => T): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { data: items.map(map), nextCursor: hasMore ? items[items.length - 1].id : null };
}

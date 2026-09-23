import 'server-only';

import { client } from '@/lib/db/drizzle';

export type ResourceQuery = Record<string, string | string[] | undefined>;

export function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export function listPage(input: ResourceQuery) {
  const value = Number(one(input.page));
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 10000) : 1;
}

export function listPageSize(input: ResourceQuery) {
  const value = Number(one(input.pageSize));
  return [10, 25, 50, 100].includes(value) ? value : 25;
}

export function listDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export function listOrder(input: ResourceQuery, expressions: Record<string, string>, fallback: string, idExpression = 'id') {
  const raw = one(input.sort);
  let clauses: { desc: boolean; id: string }[] = [];
  try
    {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed))
      {
      clauses = parsed.slice(0, 3).filter((item): item is { desc: boolean; id: string } =>
        item && typeof item === 'object' && typeof item.id === 'string'
        && Object.hasOwn(expressions, item.id) && typeof item.desc === 'boolean');
      }
    }
  catch
    {
    }
  if (!clauses.length)
    {
    clauses = [{ desc: one(input.direction) !== 'asc', id: Object.hasOwn(expressions, raw) ? raw : fallback }];
    }
  const order = [...new Set(clauses.map(({ id, desc }) => `${expressions[id]} ${desc ? 'desc' : 'asc'} nulls last`))];
  order.push(`${idExpression} desc`);
  return client.unsafe(order.join(', '));
}

export function advancedListWhere(input: ResourceQuery, columns: Record<string, string>, statuses: readonly string[]) {
  type Filter = { id?: unknown; operator?: unknown; value?: unknown };
  let filters: Filter[] = [];
  try
    {
    const value: unknown = JSON.parse(one(input.filters) || '[]');
    if (Array.isArray(value)) filters = value.slice(0, 12);
    }
  catch
    {
    }
  const conditions: ReturnType<typeof client>[] = [];
  for (const filter of filters)
    {
    if (!filter || typeof filter !== 'object' || typeof filter.id !== 'string') continue;
    const expression = columns[filter.id];
    if (!expression) continue;
    const values = (Array.isArray(filter.value) ? filter.value : [filter.value])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.slice(0, 200));
    const operator = filter.operator;
    if (filter.id === 'status' || filter.id === 'audience')
      {
      const valid = values.filter((value) => statuses.includes(value));
      if (!valid.length) continue;
      if (operator === 'ne' || operator === 'notInArray') conditions.push(client`${client.unsafe(expression)} not in ${client(valid)}`);
      else conditions.push(client`${client.unsafe(expression)} in ${client(valid)}`);
      continue;
      }
    const value = values[0];
    if (!value) continue;
    const escaped = value.replaceAll('%', '\\%').replaceAll('_', '\\_');
    if (operator === 'eq') conditions.push(client`lower(${client.unsafe(expression)}) = lower(${value})`);
    else if (operator === 'ne') conditions.push(client`lower(${client.unsafe(expression)}) <> lower(${value})`);
    else if (operator === 'notILike') conditions.push(client`${client.unsafe(expression)} not ilike ${`%${escaped}%`} escape '\\'`);
    else conditions.push(client`${client.unsafe(expression)} ilike ${`%${escaped}%`} escape '\\'`);
    }
  if (!conditions.length) return client`true`;
  const join = one(input.joinOperator) === 'or' ? 'or' : 'and';
  return conditions.slice(1).reduce((acc, condition) => join === 'or'
    ? client`(${acc} or ${condition})`
    : client`(${acc} and ${condition})`, conditions[0]);
}

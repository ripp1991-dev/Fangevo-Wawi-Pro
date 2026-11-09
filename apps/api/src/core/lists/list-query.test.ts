import { describe, expect, it } from 'vitest';
import { listQuerySchema } from '@fangevo/shared';
import { buildListArgs } from './list-query';

const spec = {
  name: { kind: 'string', sortable: true },
  createdAt: { kind: 'date', sortable: true },
  country: { kind: 'string' },
} as const;
const q = (o: Record<string, string>) => listQuerySchema.parse(o);

describe('buildListArgs', () => {
  it('erlaubt nur freigegebene Felder', () => {
    expect(() =>
      buildListArgs(
        q({ filters: JSON.stringify([{ field: 'passwordHash', op: 'eq', value: 'x' }]) }),
        spec,
        { defaultSort: 'name:asc' },
      ),
    ).toThrow(/passwordHash/);
    expect(() =>
      buildListArgs(q({ sort: 'country:asc' }), spec, { defaultSort: 'name:asc' }),
    ).toThrow(/sortiert/);
  });
  it('baut Suche, Filter, Sortierung und Seiten', () => {
    const a = buildListArgs(
      q({
        q: 'nord',
        sort: 'createdAt:desc',
        page: '3',
        pageSize: '20',
        filters: JSON.stringify([{ field: 'country', op: 'in', value: ['DE', 'AT'] }]),
      }),
      spec,
      { search: ['name'], defaultSort: 'name:asc' },
    );
    expect(a.skip).toBe(40);
    expect(a.take).toBe(20);
    expect(a.orderBy[0]).toEqual({ createdAt: 'desc' });
    expect(JSON.stringify(a.where)).toContain('"in":["DE","AT"]');
    expect(JSON.stringify(a.where)).toContain('"contains":"nord"');
  });
  it('filtert eigene Felder nur, wenn sie definiert sind', () => {
    const f = JSON.stringify([{ field: 'cf.region', op: 'eq', value: 'Nord' }]);
    expect(() =>
      buildListArgs(q({ filters: f }), spec, {
        defaultSort: 'name:asc',
        customColumn: 'customFields',
        customFields: [],
      }),
    ).toThrow();
    const a = buildListArgs(q({ filters: f }), spec, {
      defaultSort: 'name:asc',
      customColumn: 'customFields',
      customFields: [{ key: 'region', type: 'select' }],
    });
    expect(a.where).toEqual({ AND: [{ customFields: { path: ['region'], equals: 'Nord' } }] });
  });
  it('lehnt kaputte Filter ab', () => {
    expect(listQuerySchema.safeParse({ filters: '{kaputt' }).success).toBe(false);
  });
});

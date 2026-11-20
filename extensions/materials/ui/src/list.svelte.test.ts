import { describe, expect, it } from 'vitest';

import { mayOperate } from './access';
import { materialsOn, type MaterialsService, type Page } from './api';
import { MaterialList } from './list.svelte';
import { gate, stubHost } from './test/host';

const MOUNT = '/api/v1/modules/com.github.aux.prusa3d.materials';

const row = (uuid: string, is_favourite = false) => ({
  uuid,
  name: `PLA ${uuid}`,
  brand_name: 'Prusament',
  class: 'FFF',
  type: 'PLA',
  color_rgba: '#ff0000ff',
  is_favourite,
  is_custom: false,
  spools: 0,
  assigned_spools: 0,
  remaining_g: 0,
  free_g: 0,
});

const page = (rows: ReturnType<typeof row>[], next?: number) => ({
  rows,
  total: 3,
  stock_g: 750,
  stock_spools: 2,
  ...(next === undefined ? {} : { next }),
});

const listOn = (stub: ReturnType<typeof stubHost>) =>
  new MaterialList(materialsOn(stub.host), mayOperate(stub.host));

/** A service whose list answers are released by the test, one per request. */
const held = () => {
  const asked: { q: string | undefined; release: (p: Page) => void }[] = [];
  const service: MaterialsService = {
    brands: () => Promise.resolve([]),
    types: () => Promise.resolve([]),
    locations: () => Promise.resolve([]),
    createLocation: () => Promise.reject(new Error('unused')),
    renameLocation: () => Promise.reject(new Error('unused')),
    deleteLocation: () => Promise.resolve(),
    filters: () => Promise.resolve({}),
    keepFilters: () => Promise.resolve(),
    material: () => Promise.reject(new Error('unused')),
    createCustom: () => Promise.reject(new Error('unused')),
    addSpools: () => Promise.reject(new Error('unused')),
    spools: () => Promise.reject(new Error('unused')),
    updateSpool: () => Promise.reject(new Error('unused')),
    deleteSpool: () => Promise.reject(new Error('unused')),
    deleteSpools: () => Promise.reject(new Error('unused')),
    updateCustom: () => Promise.reject(new Error('unused')),
    deleteCustom: () => Promise.reject(new Error('unused')),
    tools: () => Promise.reject(new Error('unused')),
    assign: () => Promise.reject(new Error('unused')),
    unassign: () => Promise.reject(new Error('unused')),
    addReported: () => Promise.reject(new Error('unused')),
    printers: () => Promise.resolve([]),
    printerPage: () => Promise.resolve({ printers: [] }),
    merge: () => Promise.reject(new Error('unused')),
    list: (query) =>
      new Promise<Page>((resolve) => {
        asked.push({ q: query.q, release: resolve });
      }),
    star: () => Promise.resolve(),
    catalogue: () => Promise.reject(new Error('unused')),
    download: () => Promise.reject(new Error('unused')),
  };

  return { asked, service };
};

describe('the material list', () => {
  it('drops the answer to an older query and asks the new one', async () => {
    const { asked, service } = held();
    const list = new MaterialList(service, Promise.resolve(true));

    const first = list.read();
    const second = list.narrow({ q: 'pet' });
    expect(asked.map((a) => a.q)).toEqual([undefined, 'pet']);
    asked[1]?.release(page([row('new')]));
    await second;
    asked[0]?.release(page([row('old')]));
    await first;

    expect(list.rows.map((r) => r.uuid)).toEqual(['new']);
    expect(list.query.q).toBe('pet');
    expect(list.busy).toBe(false);
  });

  it('lets go of the filters and keeps the search in one read', async () => {
    const queries: unknown[] = [];
    const { service } = held();
    const list = new MaterialList(
      {
        ...service,
        list: (query) => {
          queries.push(query);
          return Promise.resolve(page([]));
        },
      },
      Promise.resolve(true),
    );
    await list.narrow({ q: 'pla', brand: 'prusament', favourites: true });
    expect(list.narrowed).toBe(true);

    await list.clearFilters();

    expect(queries).toHaveLength(2);
    expect(queries[1]).toEqual({ q: 'pla' });
    expect(list.narrowed).toBe(false);
    expect(list.filtered).toBe(true);
  });

  it('drops a next page that was asked before the person narrowed', async () => {
    const { asked, service } = held();
    const list = new MaterialList(service, Promise.resolve(true));

    const read = list.read();
    asked[0]?.release(page([row('a')], 1));
    await read;
    const more = list.more();
    const narrowed = list.narrow({ q: 'x' });
    asked[2]?.release(page([row('x')]));
    await narrowed;
    asked[1]?.release(page([row('b')]));
    await more;

    expect(list.rows.map((r) => r.uuid)).toEqual(['x']);
  });

  it('reads the facets again when asked again, as an import changes them', async () => {
    const { service } = held();
    let brands: { uuid: string; slug: string; name: string }[] = [];
    const list = new MaterialList(
      { ...service, brands: () => Promise.resolve(brands) },
      Promise.resolve(true),
    );

    await list.readFacets();
    expect(list.brands).toEqual([]);

    brands = [{ uuid: 'b', slug: 'prusament', name: 'Prusament' }];
    await list.readFacets();
    expect(list.brands.map((b) => b.slug)).toEqual(['prusament']);
  });

  it('sends one request for two reads made at the same time', async () => {
    const held = gate();
    const stub = stubHost([{ status: 200, body: page([row('a')]) }], {
      until: held.held,
    });
    const list = listOn(stub);

    const first = list.read();
    const second = list.read();
    held.open();
    await Promise.all([first, second]);

    expect(stub.calls).toHaveLength(1);
    expect(list.rows.map((r) => r.uuid)).toEqual(['a']);
    expect(list.total).toBe(3);
    expect(list.stock).toEqual({ grams: 750, spools: 2 });
    expect(list.loaded).toBe(true);
  });

  it('starts again from the first row when the person narrows it', async () => {
    const stub = stubHost([
      { status: 200, body: page([row('a')], 1) },
      { status: 200, body: page([row('b')], 2) },
      { status: 200, body: page([row('c')]) },
    ]);
    const list = listOn(stub);

    await list.read();
    await list.more();
    await list.narrow({ q: 'pla', brand: 'prusament' });

    const urls = stub.calls.map((c) => new URL(c.url, 'http://x'));
    expect(urls[1]?.searchParams.get('offset')).toBe('1');
    expect(urls[2]?.searchParams.get('offset')).toBeNull();
    expect(urls[2]?.searchParams.get('q')).toBe('pla');
    expect(list.rows.map((r) => r.uuid)).toEqual(['c']);
  });

  it('appends the next page to the rows it already holds', async () => {
    const stub = stubHost([
      { status: 200, body: page([row('a')], 1) },
      { status: 200, body: page([row('b')]) },
    ]);
    const list = listOn(stub);

    await list.read();
    await list.more();
    await list.more();

    expect(list.rows.map((r) => r.uuid)).toEqual(['a', 'b']);
    expect(stub.calls).toHaveLength(2);
  });

  it('skips a row the next page repeats after the order moved', async () => {
    const stub = stubHost([
      { status: 200, body: page([row('a'), row('b')], 2) },
      { status: 200, body: page([row('b'), row('c')]) },
    ]);
    const list = listOn(stub);

    await list.read();
    await list.more();

    expect(list.rows.map((r) => r.uuid)).toEqual(['a', 'b', 'c']);
  });

  it('stars with PUT and unstars with DELETE, keeping the row in place', async () => {
    const stub = stubHost(
      [
        { status: 200, body: page([row('a'), row('b')]) },
        { status: 204, body: null },
      ],
      { routed: {} },
    );
    const list = listOn(stub);
    await list.read();

    expect(await list.star('b', true)).toBe(true);
    expect(list.rows.map((r) => [r.uuid, r.is_favourite])).toEqual([
      ['a', false],
      ['b', true],
    ]);
    expect(await list.star('b', false)).toBe(true);
    expect(list.rows[1]?.is_favourite).toBe(false);

    expect(stub.calls.slice(1).map((c) => [c.method, c.url])).toEqual([
      ['PUT', `${MOUNT}/favourites/b`],
      ['DELETE', `${MOUNT}/favourites/b`],
    ]);
  });

  it('keeps the fault and leaves the row alone when a star is refused', async () => {
    const stub = stubHost([
      { status: 200, body: page([row('a')]) },
      {
        status: 403,
        contentType: 'application/problem+json',
        body: { code: 'materials/NO_PRINCIPAL', title: 'no', detail: 'no' },
      },
    ]);
    const list = listOn(stub);
    await list.read();

    expect(await list.star('a', true)).toBe(false);
    expect(list.fault).toBeDefined();
    expect(list.rows[0]?.is_favourite).toBe(false);
  });

  it('tells a core that has not answered from one that said no', async () => {
    const stub = stubHost([], { mayOperate: false });
    const list = listOn(stub);
    expect(list.mayWrite).toBe(false);
    expect(list.mayOnlyRead).toBe(false);

    await mayOperate(stub.host);
    await Promise.resolve();
    await Promise.resolve();

    expect(list.mayWrite).toBe(false);
    expect(list.mayOnlyRead).toBe(true);
  });

  it('stays busy after a star while a read is still in flight', async () => {
    const { asked, service } = held();
    const list = new MaterialList(service, Promise.resolve(true));

    const reading = list.read();
    await list.star('a', true);
    expect(list.busy).toBe(true);
    asked[0]?.release(page([row('a')]));
    await reading;
    expect(list.busy).toBe(false);
  });
});

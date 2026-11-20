import type { Device, ReadonlyFleet } from '@prusa/connect-ui/domain';
import { formatting } from '@prusa/connect-ui/i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import setup from '../index';
import { type Answer, gate, type Stub, stubHost } from '../test/host';

const NS = 'com.github.aux.prusa3d.materials';
const M = `/api/v1/modules/${NS}`;

const row = {
  uuid: 'a',
  name: 'Galaxy Black',
  brand_name: 'Prusament',
  class: 'FFF',
  type: 'PLA',
  color_rgba: '#3d3e3dff',
  is_favourite: false,
  is_custom: false,
  spools: 2,
  assigned_spools: 0,
  remaining_g: 700,
  free_g: 700,
};

const catalogue = {
  ...row,
  material: {
    uuid: 'a',
    slug: 'galaxy-black',
    brand_slug: 'prusament',
    name: 'Galaxy Black',
    class: 'FFF',
    type: 'PLA',
    abbreviation: '',
    color_rgba: '#3d3e3dff',
    min_print_temp: 205,
    max_print_temp: 225,
  },
  packages: [],
};

const own = {
  ...row,
  uuid: 'c1',
  name: 'Shed PETG',
  is_custom: true,
  custom: {
    uuid: 'c1',
    name: 'Shed PETG',
    brand_name: 'Local',
    class: 'FFF',
    type: 'PETG',
    abbreviation: '',
    color_rgba: '#00ff00ff',
    created_at: '2026-10-28T10:00:00Z',
    updated_at: '2026-10-28T10:00:00Z',
  },
  packages: [],
};

const spool = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  uuid: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  source: 'manual',
  tool: null,
  material_uuid: 'a',
  material_source: 'catalogue',
  material_name: 'Galaxy Black',
  brand_name: 'Prusament',
  class: 'FFF',
  type: 'PLA',
  color_rgba: '#3d3e3dff',
  full_weight_g: 1000,
  remaining_weight_g: 400,
  location: 'Shelf 1',
  notes: `note ${String(id)}`,
  created_by: 'user:demo',
  created_at: '2026-10-28T10:00:00Z',
  updated_at: '2026-10-28T10:00:00Z',
  ...extra,
});

const refused = (status: number, code: string): Answer => ({
  status,
  contentType: 'application/problem+json',
  body: { code, status, title: code, detail: 'refused' },
});

const started = (
  uuid: string | undefined,
  routed: Record<string, readonly Answer[]>,
  options: { mayOperate?: boolean; fleet?: ReadonlyFleet } = {},
): Stub => {
  history.replaceState(null, '', uuid === undefined ? '/' : `/?uuid=${uuid}`);
  const stub = stubHost([{ status: 200, body: {} }], {
    ...options,
    routed: {
      [`${M}/materials`]: [
        {
          status: 200,
          body: { rows: [], total: 0, stock_g: 0, stock_spools: 0 },
        },
      ],
      [`${M}/catalogue/brands`]: [{ status: 200, body: { brands: [] } }],
      [`${M}/types`]: [{ status: 200, body: { types: [] } }],
      [`${M}/locations`]: [{ status: 200, body: { locations: [] } }],
      [`${M}/printers`]: [{ status: 200, body: { printers: [] } }],
      // A spool on Core One reads its tools to know what its row offers.
      [`${M}/printers/core/tools`]: [
        {
          status: 200,
          body: {
            id: 'core',
            name: 'Core One',
            connected: true,
            state: 'IDLE',
            may_operate: true,
            tools: [],
          },
        },
      ],
      ...routed,
    },
  });
  void setup(stub.host);

  return stub;
};

const draw = async (stub: Stub): Promise<void> => {
  const component = stub.registered.pages.material;
  expect(component).toBeDefined();
  await render(component!);
};

const standard = (extra: Record<string, readonly Answer[]> = {}) => ({
  [`${M}/materials/a`]: [{ status: 200, body: catalogue }],
  [`${M}/materials/a/spools`]: [
    { status: 200, body: { spools: [spool(1), spool(2)], total: 2 } },
  ],
  ...extra,
});

afterEach(() => {
  history.replaceState(null, '', '/');
});

describe('the material page', () => {
  it('reads the uuid from the search and lists the spools', async () => {
    const stub = started('a', standard());
    await draw(stub);

    await expect
      .element(page.getByRole('heading', { name: 'Galaxy Black' }))
      .toBeVisible();
    await expect.element(page.getByText('note 1')).toBeVisible();
    await expect.element(page.getByText('note 2')).toBeVisible();
    expect(stub.calls.some((c) => c.url.endsWith('/materials/a'))).toBe(true);
    expect(stub.calls.some((c) => c.url.endsWith('/materials/a/spools'))).toBe(
      true,
    );
  });

  it('refreshes a masked spool location when a tool changes during loading', async () => {
    const first = gate();
    const changed = gate();
    const spoolsRoute = `${M}/materials/a/spools`;
    const stub = started(
      'a',
      standard({
        [spoolsRoute]: [
          {
            status: 200,
            body: { spools: [spool(1)], total: 1 },
            held: first.held,
          },
          {
            status: 200,
            body: {
              spools: [
                spool(1, {
                  tool: { device_id: '', tool_id: '0', gone: false },
                }),
              ],
              total: 1,
            },
          },
        ],
      }),
    );
    stub.host.client.events = () => ({
      lastEventId: undefined,
      close: () => {
        changed.open();
      },
      async *[Symbol.asyncIterator]() {
        await changed.held;
        yield {
          type: `${NS}.tool`,
          payload: {
            device_id: 'masked-printer',
            tool_id: '0',
            material_uuid: 'a',
            spool_id: 1,
          },
        } as never;
      },
    });
    await draw(stub);

    try {
      await expect
        .poll(() => stub.calls.filter((call) => call.url.endsWith(spoolsRoute)))
        .toHaveLength(1);
      changed.open();
      await expect
        .element(page.getByText('Unknown printer · Tool 1'))
        .toBeVisible();
    } finally {
      changed.open();
      first.open();
    }
    expect(stub.calls.some((call) => call.url.includes('masked-printer'))).toBe(
      false,
    );
  });

  it('names the package each spool came as, with its empty weight', async () => {
    const pkg = {
      uuid: 'p1',
      slug: 'galaxy-black-1kg',
      class: 'FFF',
      material_slug: 'galaxy-black',
      container_slug: 'spool',
      gtin: '',
      container_name: 'Prusament Spool 1kg',
      net_weight_g: 1000,
      empty_weight_g: 277,
    };
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a`]: [
          { status: 200, body: { ...catalogue, packages: [pkg] } },
        ],
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: {
              spools: [
                spool(1, { package_uuid: 'p1', empty_weight_g: 277 }),
                spool(2, { empty_weight_g: 150 }),
                spool(3),
              ],
              total: 3,
            },
          },
        ],
      }),
    );
    await draw(stub);

    const cell = (id: number) =>
      page.getByRole('row').filter({ hasText: `note ${String(id)}` });
    await expect
      .element(cell(1).getByText('Prusament Spool 1kg · empty 277 g'))
      .toBeVisible();
    await expect.element(cell(2).getByText('empty 150 g')).toBeVisible();
    // The first dash is the package; the printer cell has its own.
    await expect.element(cell(3).getByText('—').first()).toBeVisible();
  });

  it('measures the weight left against the filament, not the full spool', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: {
              spools: [
                spool(1, {
                  full_weight_g: 1277,
                  empty_weight_g: 277,
                  remaining_weight_g: 1000,
                }),
              ],
              total: 1,
            },
          },
        ],
      }),
    );
    await draw(stub);
    const bar = page.getByRole('progressbar', { name: /1/u });
    await expect.element(bar).toHaveAttribute('aria-valuemax', '1000');
    await expect.element(bar).toHaveAttribute('aria-valuenow', '1000');
  });

  it('cuts a long note to one line and opens the whole of it', async () => {
    const long = 'Bought in the spring sale. '.repeat(10).trim();
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: { spools: [spool(1, { notes: long })], total: 1 },
          },
        ],
      }),
    );
    await draw(stub);
    await page.getByRole('button', { name: 'Notes of spool 1' }).click();
    await expect
      .element(page.getByText(long, { exact: true }).last())
      .toBeVisible();
  });

  it('leads back to the list through a breadcrumb ending in the name', async () => {
    const stub = started('a', standard());
    await draw(stub);
    const trail = page.getByRole('navigation', { name: /breadcrumb/iu });
    await expect
      .element(trail.getByRole('link', { name: 'Materials' }))
      .toHaveAttribute('href', stub.host.pageHref('materials'));
    await expect.element(trail.getByText('Galaxy Black')).toBeVisible();
  });

  it('sends only the changed fields when a spool is edited', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: {
              spools: [spool(1, { location_id: 1 }), spool(2)],
              total: 2,
            },
          },
        ],
        [`${M}/locations`]: [
          {
            status: 200,
            body: {
              locations: [
                { id: 1, name: 'Shelf 1', spools: 1 },
                { id: 2, name: 'Shelf 2', spools: 0 },
              ],
            },
          },
        ],
        [`${M}/spools/1`]: [
          {
            status: 200,
            body: spool(1, { location_id: 2, location: 'Shelf 2' }),
          },
        ],
      }),
    );
    await draw(stub);
    await expect.element(page.getByText('note 1')).toBeVisible();

    await page.getByRole('button', { name: 'Edit spool 1' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Storage location' }).click();
    await page.getByRole('option', { name: 'Shelf 2' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(() => stub.calls.find((c) => c.method === 'PATCH'))
      .toBeDefined();
    const patch = stub.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toContain('/spools/1');
    expect(JSON.parse(patch.body!)).toEqual({ location_id: 2 });
    await expect.element(page.getByText('Shelf 2')).toBeVisible();
  });

  it('saves a weight left with a fraction of a gram, typed with a comma', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/spools/1`]: [
          { status: 200, body: spool(1, { remaining_weight_g: 742.5 }) },
        ],
      }),
    );
    await draw(stub);
    await expect.element(page.getByText('note 1')).toBeVisible();

    await page.getByRole('button', { name: 'Edit spool 1' }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: 'Weight left (g)' })
      .fill('742,5');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(() => stub.calls.find((c) => c.method === 'PATCH')?.body)
      .toBe(JSON.stringify({ remaining_weight_g: 742.5 }));
  });

  it('picks the location typed when Enter is pressed with no row walked to', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/locations`]: [
          {
            status: 200,
            body: { locations: [{ id: 2, name: 'Shelf 2', spools: 0 }] },
          },
        ],
        [`${M}/spools/1`]: [
          {
            status: 200,
            body: spool(1, { location_id: 2, location: 'Shelf 2' }),
          },
        ],
      }),
    );
    await draw(stub);
    await expect.element(page.getByText('note 1')).toBeVisible();

    await page.getByRole('button', { name: 'Edit spool 1' }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('combobox', { name: 'Storage location' })
      .fill('shelf 2');
    await userEvent.keyboard('{Enter}');
    expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(false);
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(() => stub.calls.find((c) => c.method === 'PATCH')?.body)
      .toBe(JSON.stringify({ location_id: 2 }));
  });

  it('shows the fault when a star is refused', async () => {
    const stub = started(
      'a',
      standard({ [`${M}/favourites/a`]: [refused(503, 'materials/BUSY')] }),
    );
    await draw(stub);
    await expect.element(page.getByText('note 1')).toBeVisible();

    await page.getByRole('button', { name: /Star/u }).click();

    await expect
      .element(page.getByRole('alert').getByText('materials/BUSY'))
      .toBeVisible();
  });

  it('writes the temperatures in the unit the reader chose', async () => {
    formatting.temperature = 'fahrenheit';
    try {
      const stub = started('a', standard());
      await draw(stub);

      await expect.element(page.getByText('401–437°F')).toBeVisible();
    } finally {
      formatting.temperature = 'celsius';
    }
  });

  it('asks before it deletes a spool, then removes the row', async () => {
    const stub = started(
      'a',
      standard({ [`${M}/spools/1`]: [{ status: 204, body: null }] }),
    );
    await draw(stub);
    await expect.element(page.getByText('note 1')).toBeVisible();

    await page.getByRole('button', { name: 'Delete spool 1' }).click();
    expect(stub.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect.element(page.getByText('note 1')).not.toBeInTheDocument();
    await expect.element(page.getByText('note 2')).toBeVisible();
    const sent = stub.calls.find((c) => c.method === 'DELETE')!;
    expect(sent.url).toContain('/spools/1');
  });

  it('copies a spool at once and lists the copy', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/spools`]: [{ status: 201, body: { added: 1 } }],
        [`${M}/materials/a/spools`]: [
          { status: 200, body: { spools: [spool(1), spool(2)], total: 2 } },
          {
            status: 200,
            body: {
              spools: [spool(1), spool(2), spool(3, { notes: 'note 1' })],
              total: 3,
            },
          },
        ],
      }),
    );
    await draw(stub);
    await expect.element(page.getByText('note 2')).toBeVisible();

    await page
      .getByRole('button', { name: 'Copy spool 1', exact: true })
      .click();

    await expect
      .element(page.getByRole('button', { name: 'Edit spool 3' }))
      .toBeVisible();
    const sent = stub.calls.find((c) => c.method === 'POST')!;
    expect(JSON.parse(sent.body!)).toEqual({
      material_uuid: 'a',
      full_weight_g: 1000,
      remaining_weight_g: 400,
      notes: 'note 1',
      quantity: 1,
    });
  });

  it('ticks every spool from the header and deletes the ticked ones in one call', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: { spools: [spool(1), spool(2), spool(3)], total: 3 },
          },
        ],
        [`${M}/spools/delete`]: [{ status: 204, body: null }],
      }),
    );
    await draw(stub);
    await expect.element(page.getByText('note 3')).toBeVisible();
    await expect
      .element(page.getByRole('button', { name: /^Delete \d+ spools?$/u }))
      .not.toBeInTheDocument();

    await page.getByRole('checkbox', { name: 'Select every spool' }).click();
    await page.getByRole('checkbox', { name: 'Select spool 2' }).click();
    await expect
      .element(page.getByRole('checkbox', { name: 'Select every spool' }))
      .toHaveAttribute('data-state', 'indeterminate');
    await page.getByRole('button', { name: 'Delete 2 spools' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect.element(page.getByText('note 1')).not.toBeInTheDocument();
    await expect.element(page.getByText('note 3')).not.toBeInTheDocument();
    await expect.element(page.getByText('note 2')).toBeVisible();
    const sent = stub.calls.find((c) => c.url.endsWith('/spools/delete'))!;
    expect(JSON.parse(sent.body!)).toEqual({ ids: [1, 3] });
    await expect
      .element(page.getByRole('button', { name: /^Delete \d+ spools?$/u }))
      .not.toBeInTheDocument();
  });

  it('deletes more than 100 ticked spools in calls of 100', async () => {
    const many = Array.from({ length: 101 }, (_, i) => spool(i + 1));
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          { status: 200, body: { spools: many, total: 101 } },
        ],
        [`${M}/spools/delete`]: [
          { status: 204, body: null },
          { status: 204, body: null },
        ],
      }),
    );
    await draw(stub);
    await expect.element(page.getByText('note 101')).toBeVisible();

    await page.getByRole('checkbox', { name: 'Select every spool' }).click();
    await page.getByRole('button', { name: 'Delete 101 spools' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect.element(page.getByText('note 101')).not.toBeInTheDocument();
    const sent = stub.calls
      .filter((c) => c.url.endsWith('/spools/delete'))
      .map((c) => (JSON.parse(c.body!) as { ids: number[] }).ids.length);
    expect(sent).toEqual([100, 1]);
  });

  it('clears the ticks when the spools are read again', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/spools`]: [{ status: 201, body: { added: 1 } }],
      }),
    );
    await draw(stub);
    await expect.element(page.getByText('note 2')).toBeVisible();

    await page.getByRole('checkbox', { name: 'Select spool 2' }).click();
    await expect
      .element(page.getByRole('button', { name: 'Delete 1 spool' }))
      .toBeVisible();
    await page
      .getByRole('button', { name: 'Copy spool 1', exact: true })
      .click();

    await expect
      .poll(() => stub.calls.filter((c) => c.url.includes('/spools')).length)
      .toBeGreaterThan(2);
    await expect
      .element(page.getByRole('button', { name: /^Delete \d+ spools?$/u }))
      .not.toBeInTheDocument();
  });

  it('keeps every ticked spool when the batch is refused', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/spools/delete`]: [refused(404, 'materials/NOT_FOUND')],
      }),
    );
    await draw(stub);
    await expect.element(page.getByText('note 2')).toBeVisible();

    await page.getByRole('checkbox', { name: 'Select every spool' }).click();
    await page.getByRole('button', { name: 'Delete 2 spools' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect
      .poll(() => stub.calls.some((c) => c.url.endsWith('/spools/delete')))
      .toBe(true);
    await expect.element(page.getByText('note 1')).toBeVisible();
    await expect.element(page.getByText('note 2')).toBeVisible();
  });

  it('says to unassign first when the batch holds a spool on a printer', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/spools/delete`]: [refused(409, 'materials/SPOOL_ASSIGNED')],
      }),
    );
    await draw(stub);
    await expect.element(page.getByText('note 2')).toBeVisible();

    await page.getByRole('checkbox', { name: 'Select every spool' }).click();
    await page.getByRole('button', { name: 'Delete 2 spools' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect
      .element(page.getByText('Unassign the spool from the printer first.'))
      .toBeVisible();
    await expect.element(page.getByText('note 1')).toBeVisible();
  });

  it('draws a material missing from the catalogue from its row', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a`]: [{ status: 200, body: { ...row, packages: [] } }],
      }),
    );
    await draw(stub);

    await expect
      .element(page.getByRole('heading', { name: 'Galaxy Black' }))
      .toBeVisible();
    await expect.element(page.getByText('note 1')).toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Edit material' }))
      .not.toBeInTheDocument();
    // The module refuses a new spool of it, but the spools keep it in the
    // list, so it stars.
    await expect
      .element(page.getByRole('button', { name: 'Add spool' }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: /Star|Unstar/u }))
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "This material is in neither the catalogue nor your own materials, so it can't be given new spools.",
        ),
      )
      .toBeVisible();
  });

  it('shows more spools a page at a time', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          { status: 200, body: { spools: [spool(1)], total: 2, next: 1 } },
          { status: 200, body: { spools: [spool(2)], total: 2 } },
        ],
      }),
    );
    await draw(stub);
    await expect.element(page.getByText('note 1')).toBeVisible();
    await expect.element(page.getByText('note 2')).not.toBeInTheDocument();

    await page.getByRole('button', { name: 'Show more' }).click();

    await expect.element(page.getByText('note 2')).toBeVisible();
    await expect.element(page.getByText('note 1')).toBeVisible();
    expect(
      stub.calls.some((c) => c.url.includes('/materials/a/spools?offset=1')),
    ).toBe(true);
    await expect
      .element(page.getByRole('button', { name: 'Show more' }))
      .not.toBeInTheDocument();
  });

  it('shows the empty state, linking back, when the material is gone', async () => {
    const stub = started('zz', {
      [`${M}/materials/zz`]: [refused(404, 'materials/NOT_FOUND')],
      [`${M}/materials/zz/spools`]: [
        { status: 200, body: { spools: [], total: 0 } },
      ],
    });
    await draw(stub);

    await expect
      .element(page.getByText('This material was not found'))
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Back to the materials' }))
      .toHaveAttribute('href', expect.stringContaining('/materials'));
  });

  it('shows the empty state when there is no uuid', async () => {
    const stub = started(undefined, {});
    await draw(stub);

    await expect
      .element(page.getByText('This material was not found'))
      .toBeVisible();
    expect(stub.calls.filter((c) => c.url.includes('/materials/'))).toEqual([]);
  });

  it('hides Edit, Delete and Add from a viewer', async () => {
    const stub = started(
      'c1',
      {
        [`${M}/materials/c1`]: [{ status: 200, body: own }],
        [`${M}/materials/c1/spools`]: [
          { status: 200, body: { spools: [spool(1)], total: 1 } },
        ],
      },
      { mayOperate: false },
    );
    await draw(stub);

    await expect.element(page.getByText('note 1')).toBeVisible();
    await expect
      .element(page.getByRole('button', { name: /Edit|Delete|Add spool/u }))
      .not.toBeInTheDocument();
    await expect
      .element(
        page.getByText('You can look at the materials but not change them.'),
      )
      .toBeVisible();
  });

  it('shows Add spool, which opens the dialog on the spool form', async () => {
    const stub = started('a', standard());
    await draw(stub);
    await page.getByRole('button', { name: 'Add spool' }).click();

    await expect
      .element(page.getByRole('dialog').getByLabelText('Quantity'))
      .toBeVisible();
    expect(stub.calls.length).toBeGreaterThan(0);
  });

  it('edits an own custom material with a full replace', async () => {
    const stub = started('c1', {
      [`${M}/materials/c1`]: [{ status: 200, body: own }],
      [`${M}/materials/c1/spools`]: [
        { status: 200, body: { spools: [], total: 0 } },
      ],
      [`${M}/custom-materials/c1`]: [{ status: 200, body: own.custom }],
    });
    await draw(stub);

    await page.getByRole('button', { name: 'Edit material' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabelText('Manufacturer *').fill('Shed');
    await dialog.getByRole('button', { name: 'Save material' }).click();

    await expect
      .poll(() => stub.calls.find((c) => c.method === 'PATCH'))
      .toBeDefined();
    const patch = stub.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toContain('/custom-materials/c1');
    expect(JSON.parse(patch.body!)).toMatchObject({
      name: 'Shed PETG',
      brand_name: 'Shed',
      type: 'PETG',
      class: 'FFF',
    });
  });

  it('keeps the alpha of the colour when a custom material is edited', async () => {
    const seeThrough = {
      ...own,
      custom: { ...own.custom, color_rgba: '#00ff0080' },
    };
    const stub = started('c1', {
      [`${M}/materials/c1`]: [{ status: 200, body: seeThrough }],
      [`${M}/materials/c1/spools`]: [
        { status: 200, body: { spools: [], total: 0 } },
      ],
      [`${M}/custom-materials/c1`]: [{ status: 200, body: seeThrough.custom }],
    });
    await draw(stub);

    await page.getByRole('button', { name: 'Edit material' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Save material' })
      .click();

    await expect
      .poll(() => stub.calls.find((c) => c.method === 'PATCH'))
      .toBeDefined();
    const patch = stub.calls.find((c) => c.method === 'PATCH')!;
    expect(JSON.parse(patch.body!)).toMatchObject({ color_rgba: '#00ff0080' });
  });

  it('shows the fault when a custom material is still in use', async () => {
    const stub = started('c1', {
      [`${M}/materials/c1`]: [{ status: 200, body: own }],
      [`${M}/materials/c1/spools`]: [
        { status: 200, body: { spools: [spool(1)], total: 1 } },
      ],
      [`${M}/custom-materials/c1`]: [refused(409, 'materials/MATERIAL_IN_USE')],
    });
    await draw(stub);

    await page.getByRole('button', { name: 'Delete material' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect
      .element(page.getByText('Spools still use this material.'))
      .toBeVisible();
  });
});

/** A printer for the picker, as GET /printers answers it. */
const printerRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id === 'core' ? 'Core One' : 'XL',
  model: id === 'core' ? 'COREONE' : 'XL',
  connected: true,
  state: 'IDLE',
  may_operate: true,
  ...extra,
});

const printers = (...rows: ReturnType<typeof printerRow>[]): Answer => ({
  status: 200,
  body: { printers: rows },
});

const toolOf = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  assignment: null,
  reported: null,
  from_nfc: false,
  assign: '',
  unassign: '',
  ...extra,
});

const toolsOf = (
  device: string,
  tools: ReturnType<typeof toolOf>[],
  extra: Record<string, unknown> = {},
): Answer => ({
  status: 200,
  body: {
    id: device,
    name: device,
    connected: true,
    state: 'IDLE',
    may_operate: true,
    tools,
    ...extra,
  },
});

/** Spool 1 on a tool, as GET /printers/{device}/tools answers it. */
const holding = (extra: Record<string, unknown> = {}) => ({
  device_id: 'core',
  tool_id: '0',
  spool_id: 1,
  material_uuid: 'a',
  material_source: 'catalogue',
  material_name: 'Galaxy Black',
  brand_name: 'Prusament',
  type: 'PLA',
  abbreviation: 'PLA',
  color_rgba: '#3d3e3dff',
  by: 'person',
  updated_at: '2026-11-02T10:00:00Z',
  ...extra,
});

/** A spool a printer read off its NFC tag. */
const nfc = (id: number, extra: Record<string, unknown> = {}) =>
  spool(id, { source: 'printer', notes: `nfc ${String(id)}`, ...extra });

const on = (device: string, tool: string) => ({
  tool: { device_id: device, tool_id: tool },
});

describe('a spool and the printers', () => {
  it('archives a spool with a reason and a note, and restores one', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: {
              spools: [
                spool(1),
                spool(2, {
                  archived_at: '2026-11-04T10:00:00Z',
                  archive_reason: 'lost',
                }),
              ],
              total: 2,
            },
          },
        ],
        [`${M}/spools/1`]: [{ status: 200, body: spool(1) }],
        [`${M}/spools/2`]: [{ status: 200, body: spool(2) }],
      }),
    );
    await draw(stub);

    // An archived spool is marked, with its reason, and cannot be assigned.
    const row = page.getByRole('row').filter({ hasText: 'note 2' });
    await expect
      .element(row.getByText('Archived', { exact: true }))
      .toHaveAttribute('title', 'Lost');
    await expect
      .element(
        page.getByRole('button', { name: 'Assign spool 2 to a printer' }),
      )
      .not.toBeInTheDocument();
    await expect
      .element(
        page.getByRole('button', { name: 'Assign spool 1 to a printer' }),
      )
      .toBeVisible();

    await page.getByRole('button', { name: 'Edit spool 1' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: 'Archived' }).click();
    await dialog
      .getByRole('combobox', { name: 'Archive reason (optional)' })
      .click();
    await page.getByRole('option', { name: 'Defective' }).click();
    await dialog
      .getByRole('textbox', { name: 'Archive note (optional)' })
      .fill('brittle');
    await dialog.getByRole('button', { name: 'Save' }).click();
    const sent = (id: number) => () =>
      stub.calls.find(
        (c) => c.method === 'PATCH' && c.url.endsWith(`/spools/${String(id)}`),
      )?.body;
    await expect.poll(sent(1)).toBeDefined();
    expect(JSON.parse(sent(1)()!)).toEqual({
      archived: true,
      archive_reason: 'defective',
      archive_reason_note: 'brittle',
    });

    // Restoring sends only archived: the module clears the reason.
    await page.getByRole('button', { name: 'Edit spool 2' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: 'Archived' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(sent(2)).toBeDefined();
    expect(JSON.parse(sent(2)()!)).toEqual({ archived: false });
  });

  it('marks a spool a printer read with an NFC badge', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          { status: 200, body: { spools: [spool(1), nfc(2)], total: 2 } },
        ],
      }),
    );
    await draw(stub);

    const badge = page
      .getByRole('row')
      .filter({ hasText: 'nfc 2' })
      .getByText('NFC', { exact: true });
    await expect.element(badge).toBeVisible();
    await expect
      .element(
        page
          .getByRole('row')
          .filter({ hasText: 'note 1' })
          .getByText('NFC', { exact: true }),
      )
      .not.toBeInTheDocument();
  });

  it('names the printer and the tool a spool is on', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [printers(printerRow('core'))],
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: {
              spools: [spool(1, on('core', '0.3')), spool(2, on('', '1'))],
              total: 2,
            },
          },
        ],
      }),
    );
    await draw(stub);

    await expect
      .element(
        page
          .getByRole('row')
          .filter({ hasText: 'note 1' })
          .getByText('Core One · Slot 4'),
      )
      .toBeVisible();
    // The module blanks a printer the person may not observe: the spool
    // keeps its place without the printer's name.
    await expect
      .element(
        page
          .getByRole('row')
          .filter({ hasText: 'note 2' })
          .getByText('Unknown printer · Tool 2'),
      )
      .toBeVisible();
  });

  it('unassigns a spool from a printer or a tool that is gone', async () => {
    const gone = (device: string, tool: string) => ({
      tool: { device_id: device, tool_id: tool, gone: true },
    });
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [printers(printerRow('core'))],
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: {
              spools: [spool(1, gone('left', '0')), spool(2, on('core', '0'))],
              total: 2,
            },
          },
          {
            status: 200,
            body: { spools: [spool(1), spool(2, on('core', '0'))], total: 2 },
          },
        ],
        [`${M}/printers/left/tools/0`]: [{ status: 204, body: null }],
      }),
    );
    await draw(stub);

    // A spool on a tool that is still there is unassigned on its printer.
    await expect
      .element(page.getByRole('button', { name: 'Unassign spool 2' }))
      .not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Unassign spool 1' }).click();

    await expect
      .poll(() => stub.calls.find((c) => c.method === 'DELETE')?.url)
      .toContain('/printers/left/tools/0');
    await expect
      .element(
        page.getByRole('button', { name: 'Assign spool 1 to a printer' }),
      )
      .toBeVisible();
  });

  it('offers Unassign for a spool on a printer on the host', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [printers(printerRow('core'))],
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: { spools: [spool(1, on('core', '0.1'))], total: 1 },
          },
          { status: 200, body: { spools: [spool(1)], total: 1 } },
        ],
        [`${M}/printers/core/tools`]: [
          toolsOf('core', [
            toolOf('0.1', {
              kind: 'slot',
              active: false,
              assignment: holding({ tool_id: '0.1' }),
            }),
          ]),
        ],
        [`${M}/printers/core/tools/0.1`]: [{ status: 204, body: null }],
      }),
    );
    await draw(stub);

    await page.getByRole('button', { name: 'Unassign spool 1' }).click();

    await expect
      .poll(() => stub.calls.find((c) => c.method === 'DELETE')?.url)
      .toContain('/printers/core/tools/0.1');
    await expect
      .element(
        page.getByRole('button', { name: 'Assign spool 1 to a printer' }),
      )
      .toBeVisible();
  });

  it('offers Unassign for a spool on an offline printer', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [
          printers(printerRow('core', { connected: false, state: 'OFFLINE' })),
        ],
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: { spools: [spool(1, on('core', '0'))], total: 1 },
          },
        ],
        [`${M}/printers/core/tools`]: [
          toolsOf(
            'core',
            [
              toolOf('0', {
                kind: 'head',
                active: true,
                assignment: holding(),
              }),
            ],
            { connected: false, state: 'OFFLINE' },
          ),
        ],
        [`${M}/printers/core/tools/0`]: [{ status: 204, body: null }],
      }),
    );
    await draw(stub);

    await expect
      .element(page.getByRole('button', { name: 'Unload spool 1' }))
      .not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Unassign spool 1' }).click();

    await expect
      .poll(() => stub.calls.find((c) => c.method === 'DELETE')?.url)
      .toContain('/printers/core/tools/0');
  });

  it('offers Unload for a spool in a connected print head', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [printers(printerRow('core'))],
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: { spools: [spool(1, on('core', '0'))], total: 1 },
          },
        ],
        [`${M}/printers/core/tools`]: [
          toolsOf('core', [
            toolOf('0', { kind: 'head', active: false, assignment: holding() }),
          ]),
        ],
        '/api/v1/devices/core/commands': [{ status: 200, body: { ok: true } }],
      }),
    );
    await draw(stub);

    const unload = page.getByRole('button', { name: 'Unload spool 1' });
    await expect.element(unload).toHaveTextContent('Unload');
    // The printer keeps the material on a head it unloads: a head offers no
    // Unassign while its printer is connected.
    await expect
      .element(page.getByRole('button', { name: 'Unassign spool 1' }))
      .not.toBeInTheDocument();
    await unload.click();

    await expect
      .poll(() =>
        stub.calls.find((c) => c.url === '/api/v1/devices/core/commands'),
      )
      .toBeDefined();
    const command = stub.calls.find(
      (c) => c.url === '/api/v1/devices/core/commands',
    );
    expect(JSON.parse(command?.body ?? '{}')).toMatchObject({
      verb: 'core.command.unload_filament',
    });
  });

  it('disables Unload on a printing head and says why', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [
          printers(printerRow('core', { state: 'PRINTING' })),
        ],
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: { spools: [spool(1, on('core', '0'))], total: 1 },
          },
        ],
        [`${M}/printers/core/tools`]: [
          toolsOf(
            'core',
            [
              toolOf('0', {
                kind: 'head',
                active: true,
                unassign: 'printing',
                assign: 'printing',
                assignment: holding(),
              }),
            ],
            { state: 'PRINTING' },
          ),
        ],
      }),
    );
    await draw(stub);

    await expect
      .element(page.getByRole('button', { name: 'Unload spool 1' }))
      .toBeDisabled();
    const mark = page
      .getByRole('row')
      .filter({ hasText: 'note 1' })
      .element()
      .querySelector('[data-part="reasons"]')
      ?.closest<HTMLElement>('[data-part="tap-tooltip"]');
    expect(mark).toBeDefined();
    mark!.click();
    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent('Cannot unload while printing');
  });

  it.each(['PRINTING', 'PAUSED'])(
    'refuses with the reason while the printer prints or is paused (%s)',
    async (state) => {
      const stub = started(
        'a',
        standard({
          [`${M}/printers`]: [printers(printerRow('core', { state }))],
          [`${M}/materials/a/spools`]: [
            {
              status: 200,
              body: { spools: [spool(1, on('core', '0.1'))], total: 1 },
            },
          ],
          [`${M}/printers/core/tools`]: [
            toolsOf(
              'core',
              [
                toolOf('0.1', {
                  kind: 'slot',
                  active: true,
                  unassign: 'printing',
                  assign: 'printing',
                  assignment: holding({ tool_id: '0.1' }),
                }),
              ],
              { state },
            ),
          ],
        }),
      );
      await draw(stub);

      await expect
        .element(page.getByRole('button', { name: 'Unassign spool 1' }))
        .toBeDisabled();
      const row = page.getByRole('row').filter({ hasText: 'note 1' });
      const mark = row
        .element()
        .querySelector('[data-part="reasons"]')
        ?.closest<HTMLElement>('[data-part="tap-tooltip"]');
      expect(mark).toBeDefined();
      mark!.click();
      await expect
        .element(page.getByRole('tooltip'))
        .toHaveTextContent('Cannot remove material while printing');
    },
  );

  it('reads the tools again when the printer starts printing', async () => {
    const live = $state({
      devices: [
        { id: 'core', connected: true, state: { '/state': 'IDLE' } },
      ] as unknown as Device[],
    });
    const fleet: ReadonlyFleet = {
      get devices() {
        return live.devices;
      },
      loading: false,
      loaded: true,
      error: undefined,
      device: (id) => live.devices.find((d) => d.id === id),
    };
    const slot = toolOf('0.1', {
      kind: 'slot',
      active: true,
      assignment: holding({ tool_id: '0.1' }),
    });
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [printers(printerRow('core'))],
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: { spools: [spool(1, on('core', '0.1'))], total: 1 },
          },
        ],
        [`${M}/printers/core/tools`]: [
          toolsOf('core', [slot]),
          toolsOf(
            'core',
            [{ ...slot, assign: 'printing', unassign: 'printing' }],
            { state: 'PRINTING' },
          ),
        ],
      }),
      { fleet },
    );
    await draw(stub);
    const unassign = page.getByRole('button', { name: 'Unassign spool 1' });
    await expect.element(unassign).toBeEnabled();

    live.devices = [
      { id: 'core', connected: true, state: { '/state': 'PRINTING' } },
    ] as unknown as Device[];

    await expect.element(unassign).toBeDisabled();
    await expect
      .element(page.getByText('Cannot remove material while printing'))
      .toBeInTheDocument();
  });

  it('reads the tools again on the poll when the first read after a print starts is stale', async () => {
    // The module answers the tools from what it last heard of the printer,
    // so the read right after the state moves may still say IDLE.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const live = $state({
        devices: [
          { id: 'core', connected: true, state: { '/state': 'IDLE' } },
        ] as unknown as Device[],
      });
      const fleet: ReadonlyFleet = {
        get devices() {
          return live.devices;
        },
        loading: false,
        loaded: true,
        error: undefined,
        device: (id) => live.devices.find((d) => d.id === id),
      };
      const head = toolOf('0', {
        kind: 'head',
        active: true,
        assignment: holding(),
      });
      const stub = started(
        'a',
        standard({
          [`${M}/printers`]: [printers(printerRow('core'))],
          [`${M}/materials/a/spools`]: [
            {
              status: 200,
              body: { spools: [spool(1, on('core', '0'))], total: 1 },
            },
          ],
          [`${M}/printers/core/tools`]: [
            toolsOf('core', [head]),
            toolsOf('core', [head]),
            toolsOf('core', [{ ...head, unassign: 'printing' }], {
              state: 'PRINTING',
            }),
          ],
        }),
        { fleet },
      );
      await draw(stub);
      const unload = page.getByRole('button', { name: 'Unload spool 1' });
      await expect.element(unload).toBeEnabled();
      const reads = (): number =>
        stub.calls.filter((c) => c.url.endsWith('/printers/core/tools')).length;

      live.devices = [
        { id: 'core', connected: true, state: { '/state': 'PRINTING' } },
      ] as unknown as Device[];
      await expect.poll(reads).toBe(2);
      await expect.element(unload).toBeEnabled();

      vi.advanceTimersByTime(15_000);
      await expect.poll(reads).toBe(3);
      await expect.element(unload).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables Delete and the tick of a spool on a printer, and says why', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: { spools: [spool(1, on('core', '0')), spool(2)], total: 2 },
          },
        ],
        [`${M}/spools/delete`]: [{ status: 204, body: null }],
      }),
    );
    await draw(stub);

    const remove = page.getByRole('button', { name: 'Delete spool 1' });
    await expect.element(remove).toBeDisabled();
    // A tap on a disabled button says why, as a touch screen has no hover.
    remove.element().closest<HTMLElement>('[data-part="tap-tooltip"]')!.click();
    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent(
        'Unassign the spool from the printer before deleting it',
      );
    await expect
      .element(page.getByRole('checkbox', { name: 'Select spool 1' }))
      .toBeDisabled();
    await expect
      .element(
        page.getByRole('button', { name: 'Assign spool 1 to a printer' }),
      )
      .not.toBeInTheDocument();

    // Every spool the header ticks is one a delete can take.
    await page.getByRole('checkbox', { name: 'Select every spool' }).click();
    await page.getByRole('button', { name: 'Delete 1 spool' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect
      .poll(() => stub.calls.find((c) => c.url.endsWith('/spools/delete')))
      .toBeDefined();
    const sent = stub.calls.find((c) => c.url.endsWith('/spools/delete'))!;
    expect(JSON.parse(sent.body!)).toEqual({ ids: [2] });
  });

  it('edits the notes of a spool on a printer, and not its weight or archive', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: { spools: [spool(1, on('core', '0'))], total: 1 },
          },
        ],
        [`${M}/spools/1`]: [{ status: 200, body: spool(1, on('core', '0')) }],
      }),
    );
    await draw(stub);

    await page.getByRole('button', { name: 'Edit spool 1' }).click();
    const dialog = page.getByRole('dialog');
    await expect
      .element(dialog.getByRole('textbox', { name: 'Weight left (g)' }))
      .toBeDisabled();
    await expect
      .element(dialog.getByRole('checkbox', { name: 'Archived' }))
      .toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Notes' }).fill('dry');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(() => stub.calls.find((c) => c.method === 'PATCH')?.body)
      .toBeDefined();
    const patch = stub.calls.find((c) => c.method === 'PATCH')!;
    expect(JSON.parse(patch.body!)).toEqual({ notes: 'dry' });
  });

  it('assigns a spool to a printer with one tool in one click', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [printers(printerRow('core'))],
        [`${M}/printers/core/tools`]: [toolsOf('core', [toolOf('0')])],
        [`${M}/printers/core/tools/0`]: [{ status: 200, body: {} }],
        [`${M}/materials/a/spools`]: [
          { status: 200, body: { spools: [spool(1)], total: 1 } },
          {
            status: 200,
            body: { spools: [spool(1, on('core', '0'))], total: 1 },
          },
        ],
      }),
    );
    await draw(stub);

    await page
      .getByRole('button', { name: 'Assign spool 1 to a printer' })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Core One/u })
      .click();

    await expect
      .poll(() => stub.calls.find((c) => c.method === 'PUT'))
      .toBeDefined();
    const put = stub.calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain('/printers/core/tools/0');
    expect(JSON.parse(put.body!)).toEqual({ spool_id: 1 });
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await expect
      .element(
        page
          .getByRole('row')
          .filter({ hasText: 'note 1' })
          .getByText('Core One · Tool 1'),
      )
      .toBeVisible();
    // The page names only the printer its spool is on.
    expect(
      stub.calls
        .filter((c) => c.url.includes('/printers?id='))
        .map((c) => new URL(c.url, 'http://x').search),
    ).toEqual(['?id=core']);
  });

  it('lists the printers with model and state, a page at a time, and searches them', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [
          // The dialog reads a page, then the next as its end shows.
          { status: 200, body: { printers: [printerRow('core')], next: 1 } },
          {
            status: 200,
            body: { printers: [printerRow('xl', { state: 'PRINTING' })] },
          },
          { status: 200, body: { printers: [printerRow('xl')] } },
        ],
      }),
    );
    await draw(stub);

    await page
      .getByRole('button', { name: 'Assign spool 1 to a printer' })
      .click();
    const dialog = page.getByRole('dialog');
    // Each row names the model and wears its state, as Core's printer list.
    await expect.element(dialog.getByText('Printing')).toBeVisible();
    await expect.element(dialog.getByText('Idle')).toBeVisible();
    await expect.element(dialog.getByText('CORE One')).toBeVisible();
    const read = (): string[] =>
      stub.calls
        .filter((c) => c.url.includes('/printers?'))
        .map((c) => new URL(c.url, 'http://x').search);
    expect(read()).toEqual(['?q=&offset=0&limit=50', '?q=&offset=1&limit=50']);

    await dialog.getByRole('searchbox', { name: 'Search printers' }).fill('xl');
    await expect.poll(read).toContain('?q=xl&offset=0&limit=50');
    await expect
      .element(dialog.getByRole('button', { name: /Core One/u }))
      .not.toBeInTheDocument();
  });

  it('reads the printers again on Try again, and drops the fault', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [
          refused(400, 'materials/INVALID'),
          printers(printerRow('core')),
        ],
      }),
    );
    await draw(stub);

    await page
      .getByRole('button', { name: 'Assign spool 1 to a printer' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Try again' }).click();

    await expect
      .element(dialog.getByRole('button', { name: /Core One/u }))
      .toBeVisible();
    await expect
      .element(dialog.getByRole('button', { name: 'Try again' }))
      .not.toBeInTheDocument();
    await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a printer the person may not operate as disabled, and why', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [
          printers(printerRow('core', { may_operate: false })),
        ],
      }),
    );
    await draw(stub);

    await page
      .getByRole('button', { name: 'Assign spool 1 to a printer' })
      .click();

    const dialog = page.getByRole('dialog');
    await expect
      .element(dialog.getByRole('button', { name: /Core One/u }))
      .toBeDisabled();
    await expect
      .element(dialog.getByText('You need permission to operate this printer'))
      .toBeVisible();
  });

  it('drops the tools of a printer picked before the dialog closed', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          { status: 200, body: { spools: [spool(1), spool(2)], total: 2 } },
        ],
        [`${M}/printers`]: [printers(printerRow('xl'))],
        [`${M}/printers/xl/tools`]: [
          { ...toolsOf('xl', [toolOf('0'), toolOf('1')]), held },
        ],
      }),
    );
    await draw(stub);

    await page
      .getByRole('button', { name: 'Assign spool 1 to a printer' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /XL/u }).click();
    await expect
      .poll(() => stub.calls.some((c) => c.url.endsWith('/printers/xl/tools')))
      .toBe(true);
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();

    await page
      .getByRole('button', { name: 'Assign spool 2 to a printer' })
      .click();
    await expect
      .element(dialog.getByRole('button', { name: /XL/u }))
      .toBeVisible();
    release();
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Still the printers: the late tools belonged to the dialog for spool 1.
    await expect
      .element(dialog.getByRole('button', { name: /Tool 1/u }))
      .not.toBeInTheDocument();
    await expect
      .element(dialog.getByRole('button', { name: /XL/u }))
      .toBeVisible();
  });

  it('picks the tool of a printer with more than one, a refused one disabled with its reason', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [printers(printerRow('xl'))],
        [`${M}/printers/xl/tools`]: [
          toolsOf('xl', [
            toolOf('0', { assign: 'reported-empty' }),
            toolOf('1'),
          ]),
        ],
        [`${M}/printers/xl/tools/1`]: [{ status: 200, body: {} }],
      }),
    );
    await draw(stub);

    await page
      .getByRole('button', { name: 'Assign spool 1 to a printer' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /XL/u }).click();

    await expect
      .element(dialog.getByRole('button', { name: /Tool 1/u }))
      .toBeDisabled();
    await expect
      .element(
        dialog.getByText(
          'Load a spool on the printer before assigning a material',
        ),
      )
      .toBeVisible();
    expect(stub.calls.some((c) => c.method === 'PUT')).toBe(false);

    await dialog.getByRole('button', { name: /Tool 2/u }).click();

    await expect
      .poll(() => stub.calls.find((c) => c.method === 'PUT')?.url)
      .toContain('/printers/xl/tools/1');
  });

  it('offers the five slots of an MMU printer, and not its head', async () => {
    // GET /printers/{device}/tools leaves out a head that carries a feeder.
    const slots = ['0.0', '0.1', '0.2', '0.3', '0.4'];
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [printers(printerRow('core'))],
        [`${M}/printers/core/tools`]: [
          toolsOf(
            'core',
            slots.map((id) => toolOf(id)),
          ),
        ],
        [`${M}/printers/core/tools/0.2`]: [{ status: 200, body: {} }],
      }),
    );
    await draw(stub);

    await page
      .getByRole('button', { name: 'Assign spool 1 to a printer' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Core One/u }).click();

    for (const n of [1, 2, 3, 4, 5]) {
      await expect
        .element(dialog.getByRole('button', { name: `Slot ${String(n)}` }))
        .toBeEnabled();
    }
    await expect
      .element(dialog.getByRole('button', { name: /Tool 1/u }))
      .not.toBeInTheDocument();
    expect(stub.calls.some((c) => c.method === 'PUT')).toBe(false);

    await dialog.getByRole('button', { name: 'Slot 3' }).click();
    await expect
      .poll(() => stub.calls.find((c) => c.method === 'PUT')?.url)
      .toContain('/printers/core/tools/0.2');
  });

  it('says why the module refused the assign', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/printers`]: [printers(printerRow('core'))],
        [`${M}/printers/core/tools`]: [
          toolsOf('core', [
            toolOf('0', {
              reported: {
                abbreviation: 'PETG',
                instance_uuid: '',
                package_uuid: '',
                material_uuid: '',
                type: 'PETG',
                color_rgba: '',
              },
            }),
          ]),
        ],
        [`${M}/printers/core/tools/0`]: [
          {
            status: 409,
            contentType: 'application/problem+json',
            body: {
              code: 'materials/TOOL_REFUSED',
              status: 409,
              title: 'refused',
              detail: 'refused',
              params: { reason: 'reported-loaded', state: 'IDLE' },
            },
          },
        ],
      }),
    );
    await draw(stub);

    await page
      .getByRole('button', { name: 'Assign spool 1 to a printer' })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Core One/u })
      .click();

    await expect
      .element(
        page
          .getByRole('dialog')
          .getByText(
            'The material does not match the material the printer reports (PETG). Pick a PETG material, or unload the filament first.',
          ),
      )
      .toBeVisible();
  });

  it('merges a spool added by hand into a printer spool of the material', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          {
            status: 200,
            body: {
              spools: [spool(1), spool(2, on('core', '0')), nfc(7), nfc(8)],
              total: 4,
            },
          },
          { status: 200, body: { spools: [nfc(7), spool(2)], total: 2 } },
        ],
        [`${M}/spools/1/merge`]: [{ status: 200, body: nfc(7) }],
      }),
    );
    await draw(stub);

    // Not on a spool on a printer, nor on a printer spool.
    await expect
      .element(
        page.getByRole('button', { name: 'Merge spool 2 into an NFC spool' }),
      )
      .not.toBeInTheDocument();
    await expect
      .element(
        page.getByRole('button', { name: 'Merge spool 7 into an NFC spool' }),
      )
      .not.toBeInTheDocument();

    await page
      .getByRole('button', { name: 'Merge spool 1 into an NFC spool' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /Spool #8/u }).click();
    await expect
      .element(dialog.getByText(/Spool #1 and spool #8 are one spool/u))
      .toBeVisible();
    await dialog.getByRole('button', { name: 'Merge' }).click();

    await expect
      .poll(() => stub.calls.find((c) => c.url.endsWith('/spools/1/merge')))
      .toBeDefined();
    const sent = stub.calls.find((c) => c.url.endsWith('/spools/1/merge'))!;
    expect(JSON.parse(sent.body!)).toEqual({ into: 8 });
    await expect.element(page.getByText('note 1')).not.toBeInTheDocument();
  });

  it('offers a merge while later pages may hold a printer spool, and lists it', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          { status: 200, body: { spools: [spool(1)], total: 2, next: 1 } },
          { status: 200, body: { spools: [nfc(9)], total: 2 } },
        ],
      }),
    );
    await draw(stub);

    await page
      .getByRole('button', { name: 'Merge spool 1 into an NFC spool' })
      .click();

    await expect
      .element(
        page.getByRole('dialog').getByRole('radio', { name: /Spool #9/u }),
      )
      .toBeVisible();
    expect(
      stub.calls.some((c) => c.url.includes('/materials/a/spools?offset=1')),
    ).toBe(true);
  });

  it('says so when the later pages hold no printer spool', async () => {
    const stub = started(
      'a',
      standard({
        [`${M}/materials/a/spools`]: [
          { status: 200, body: { spools: [spool(1)], total: 2, next: 1 } },
          { status: 200, body: { spools: [spool(2)], total: 2 } },
        ],
      }),
    );
    await draw(stub);

    await page
      .getByRole('button', { name: 'Merge spool 1 into an NFC spool' })
      .click();

    const dialog = page.getByRole('dialog');
    await expect
      .element(dialog.getByText('This material has no spool a printer read.'))
      .toBeVisible();
    await expect
      .element(dialog.getByRole('button', { name: 'Merge' }))
      .toBeDisabled();
  });

  it('offers no merge when the material has no printer spool', async () => {
    const stub = started('a', standard());
    await draw(stub);
    await expect.element(page.getByText('note 1')).toBeVisible();

    await expect
      .element(page.getByRole('button', { name: /^Merge spool/u }))
      .not.toBeInTheDocument();
  });
});

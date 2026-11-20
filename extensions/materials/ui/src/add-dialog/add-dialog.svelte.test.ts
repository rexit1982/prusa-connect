import { Toaster } from '@prusa/connect-ui/primitives';
import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import setup from '../index';
import { type Answer, type Stub, stubHost } from '../test/host';
import AddDialog from './add-dialog.svelte';

// The dialog over the module's own setup, so it reads the host, the list and
// the catalogue the app would hand it.

const NS = 'com.github.aux.prusa3d.materials';
const M = `/api/v1/modules/${NS}`;

const row = (uuid: string, extra: Record<string, unknown> = {}) => ({
  uuid,
  name: `PLA ${uuid}`,
  brand_name: 'Prusament',
  class: 'FFF',
  type: 'PLA',
  color_rgba: '#ff0000ff',
  is_favourite: false,
  is_custom: false,
  spools: 0,
  remaining_g: 0,
  free_g: 0,
  ...extra,
});

const listing = (rows: ReturnType<typeof row>[]) => ({
  rows,
  total: rows.length,
  stock_g: 0,
  stock_spools: 0,
});

const detail = {
  ...row('a'),
  material: {
    uuid: 'a',
    slug: 'pla-a',
    brand_slug: 'prusament',
    name: 'PLA a',
    class: 'FFF',
    type: 'PLA',
    abbreviation: '',
    color_rgba: '#ff0000ff',
    min_print_temp: 205,
    max_print_temp: 225,
    min_bed_temp: 50,
    max_bed_temp: 60,
    density: 1.24,
    tags: ['abrasive', 'contains_carbon_fiber'],
  },
  packages: [
    {
      uuid: 'p1',
      slug: 'pla-a-1kg',
      class: 'FFF',
      material_slug: 'pla-a',
      container_slug: 'spool',
      gtin: '',
      container_name: 'Prusament spool',
      net_weight_g: 1000,
      empty_weight_g: 200,
      length_mm: 330000,
    },
  ],
};

const custom = {
  uuid: 'c1',
  name: 'Shed PETG',
  brand_name: 'Local',
  class: 'FFF',
  type: 'PETG',
  abbreviation: '',
  color_rgba: '#00ff00ff',
  created_at: '2026-10-28T10:00:00Z',
  updated_at: '2026-10-28T10:00:00Z',
};

const refused = (status: number, code: string): Answer => ({
  status,
  contentType: 'application/problem+json',
  body: { code, status, title: code, detail: 'refused' },
});

const shelves: Answer = {
  status: 200,
  body: {
    locations: [
      { id: 1, name: 'Dry box', spools: 0 },
      { id: 2, name: 'Shelf A', spools: 2 },
    ],
  },
};

const started = (
  routed: Record<string, readonly Answer[]> = {},
  loaded = true,
): Stub => {
  const stub = stubHost([{ status: 200, body: {} }], {
    routed: {
      [`${M}/catalogue`]: [
        { status: 200, body: { loaded, import: { phase: 'idle' } } },
      ],
      [`${M}/types`]: [{ status: 200, body: { types: ['PETG', 'PLA'] } }],
      [`${M}/catalogue/brands`]: [
        {
          status: 200,
          body: {
            brands: [{ uuid: 'b1', slug: 'prusament', name: 'Prusament' }],
          },
        },
      ],
      [`${M}/materials`]: [{ status: 200, body: listing([row('a')]) }],
      [`${M}/materials/a`]: [{ status: 200, body: detail }],
      // The list the picker reads, however often it reads it.
      [`${M}/locations`]: [shelves],
      // Two spools, as the module answers a quantity of 2.
      [`${M}/spools`]: [{ status: 201, body: { added: 2, ids: [1, 2] } }],
      ...routed,
    },
  });
  void setup(stub.host);

  return stub;
};

/** Opens the dialog as a row's + does, on material a, at the spool form. */
const open = async (
  { material }: { material?: string } = { material: 'a' },
) => {
  const onclose = vi.fn();
  const onadded = vi.fn();
  const shown = await render(AddDialog, {
    open: true,
    onclose,
    onadded,
    material,
  });
  const dialog = page.getByRole('dialog');
  if (material !== undefined) {
    await expect.element(dialog.getByLabelText('Quantity')).toBeVisible();
  }

  return { onclose, onadded, dialog, shown };
};

const lists = (stub: Stub): URL[] =>
  stub.calls
    .filter((c) => /\/materials(\?|$)/.test(c.url))
    .map((c) => new URL(c.url, 'http://x'));

/** Picks row a in step 1 and goes on to step 2. */
const pick = async () => {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /PLA a/u }).click();
  await expect.element(dialog.getByText('205–225°C')).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect
    .element(dialog.getByRole('button', { name: 'Change material' }))
    .toBeVisible();
};

/** The spools the dialog posted, as the module read them. */
const sent = (stub: Stub): { location_id?: number } =>
  JSON.parse(
    stub.calls.find((c) => c.url.endsWith('/spools'))?.body ?? '{}',
  ) as { location_id?: number };

/** Picks the one package through the select, as a person does. */
const choosePackage = async () => {
  await page.getByRole('dialog').getByLabelText('Package').click();
  await page
    .getByRole('option', { name: 'Prusament spool — 1,000 g · empty 200 g' })
    .click();
};

describe('the add dialog', () => {
  it('opens on the given material with no search of its own', async () => {
    const stub = started();
    const { dialog } = await open();
    await expect.element(dialog.getByText('PLA a')).toBeVisible();
    expect(dialog.getByLabelText('Search').query()).toBe(null);
    expect(lists(stub)).toHaveLength(0);
  });

  it('posts the spools with their quantity, toasts and closes', async () => {
    const stub = started();
    await render(Toaster);
    const { dialog, onclose, onadded } = await open();

    await dialog.getByLabelText('Quantity').fill('2');
    await choosePackage();
    await expect
      .element(dialog.getByLabelText('Full weight (g)'))
      .toHaveValue('1200');
    await dialog.getByRole('button', { name: 'Add spools' }).click();

    await expect.poll(() => onclose.mock.calls.length).toBe(1);
    expect(onadded).toHaveBeenCalledWith(2);
    const post = stub.calls.find((c) => c.url.endsWith('/spools'));
    expect(post?.method).toBe('POST');
    expect(JSON.parse(post!.body!)).toMatchObject({
      material_uuid: 'a',
      package_uuid: 'p1',
      quantity: 2,
      remaining_weight_g: 1000,
    });
    await expect.element(page.getByText('2 spools created')).toBeVisible();
  });

  it('offers the locations on focus and sends the picked one by id', async () => {
    const stub = started();
    const { dialog } = await open();
    const field = dialog.getByRole('combobox', { name: 'Storage location' });
    await expect
      .poll(() => stub.calls.some((c) => c.url.endsWith('/locations')))
      .toBe(true);

    await field.click();
    await expect
      .element(page.getByRole('option', { name: 'Dry box' }))
      .toBeVisible();
    await field.fill('shel');
    await expect
      .element(page.getByRole('option', { name: 'Dry box' }))
      .not.toBeInTheDocument();
    await page.getByRole('option', { name: 'Shelf A' }).click();
    await expect.element(field).toHaveValue('Shelf A');

    await choosePackage();
    await dialog.getByRole('button', { name: 'Add spools' }).click();
    await expect.poll(() => sent(stub).location_id).toBe(2);
  });

  it('creates a location from a name no location has, and picks it', async () => {
    // The list the picker reads, then what the Create row makes.
    const stub = started({
      [`${M}/locations`]: [
        shelves,
        { status: 200, body: { id: 3, name: 'Garage', spools: 0 } },
      ],
    });
    const { dialog } = await open();
    const field = dialog.getByRole('combobox', { name: 'Storage location' });
    await field.fill('Garage');
    await page.getByRole('option', { name: 'Create “Garage”' }).click();

    await expect.element(field).toHaveValue('Garage');
    const made = stub.calls.find(
      (c) => c.method === 'POST' && c.url.endsWith('/locations'),
    );
    expect(JSON.parse(made!.body!)).toEqual({ name: 'Garage' });

    await choosePackage();
    await dialog.getByRole('button', { name: 'Add spools' }).click();
    await expect.poll(() => sent(stub).location_id).toBe(3);
  });

  it('shows a full shelf and keeps the form', async () => {
    started({
      [`${M}/spools`]: [refused(409, 'materials/SHELF_FULL')],
    });
    const { dialog, onclose } = await open();
    await choosePackage();
    await dialog.getByRole('button', { name: 'Add spools' }).click();

    await expect
      .element(dialog.getByText(/already keeps as many spools/u))
      .toBeVisible();
    await expect.element(dialog.getByLabelText('Quantity')).toBeVisible();
    expect(onclose).not.toHaveBeenCalled();
  });

  it('shows a busy database as try again in a moment', async () => {
    started({
      [`${M}/spools`]: [refused(503, 'materials/BUSY')],
    });
    const { dialog } = await open();
    await choosePackage();
    await dialog.getByRole('button', { name: 'Add spools' }).click();
    await expect
      .element(dialog.getByText(/Try again in a moment/u))
      .toBeVisible();
  });

  it('starts the form again when it is closed and opened again', async () => {
    started();
    const { dialog, shown, onclose, onadded } = await open();
    await dialog.getByLabelText('Quantity').fill('5');

    const props = { open: true, onclose, onadded, material: 'a' };
    await shown.rerender({ ...props, open: false });
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await shown.rerender(props);

    await expect
      .element(page.getByRole('dialog').getByLabelText('Quantity'))
      .toHaveValue(1);
  });

  it('reads 20 materials and sends the search after a pause', async () => {
    const stub = started();
    const { dialog } = await open({});
    await expect.element(dialog.getByText('PLA a')).toBeVisible();
    expect(lists(stub)[0]!.searchParams.get('limit')).toBe('20');

    await dialog.getByLabelText('Search').fill('pet');
    await expect
      .poll(() => lists(stub).at(-1)!.searchParams.get('q'))
      .toBe('pet');
    // One request for the whole word, not one per letter.
    expect(lists(stub).filter((u) => u.searchParams.has('q'))).toHaveLength(1);
  });

  it('holds the details place with a hint, then fills it with the pick', async () => {
    started();
    const { dialog } = await open({});
    await expect
      .element(dialog.getByRole('list', { name: 'Steps of adding spools' }))
      .toBeVisible();
    expect(
      dialog
        .getByRole('list', { name: 'Steps of adding spools' })
        .element()
        .querySelector('[aria-current="step"]')?.textContent,
    ).toContain('Choose material');
    await expect
      .element(dialog.getByText(/its details show up here/u))
      .toBeVisible();

    await dialog.getByRole('button', { name: /PLA a/u }).click();
    await expect
      .element(dialog.getByText('Contains carbon fiber'))
      .toBeVisible();
    await expect.element(dialog.getByText('Abrasive')).toBeVisible();
    expect(dialog.getByText(/its details show up here/u).query()).toBe(null);
  });

  it('filters by a swatch and clears every filter', async () => {
    const stub = started();
    const { dialog } = await open({});
    await expect.element(dialog.getByText('PLA a')).toBeVisible();

    await dialog.getByRole('button', { name: 'Orange' }).click();
    await expect
      .poll(() => lists(stub).at(-1)!.searchParams.get('color'))
      .toBe('orange');

    await dialog.getByRole('button', { name: 'Clear filters' }).click();
    await expect
      .poll(() => lists(stub).at(-1)!.searchParams.has('color'))
      .toBe(false);
  });

  it('shows the details of a picked material, then goes to step 2 and back', async () => {
    started();
    const { dialog } = await open({});
    await pick();
    await expect.element(dialog.getByLabelText('Quantity')).toBeVisible();

    await dialog.getByRole('button', { name: 'Change material' }).click();
    await expect.element(dialog.getByLabelText('Search')).toBeVisible();
  });

  it('offers only the custom path and a settings link with no catalogue', async () => {
    const stub = started({}, false);
    const { dialog } = await open({});
    await expect
      .element(dialog.getByText(/No material catalogue is loaded/u))
      .toBeVisible();
    await expect
      .element(dialog.getByRole('link', { name: 'Catalogue settings' }))
      .toHaveAttribute('href', `/settings/extensions/${NS}/${NS}.catalogue`);
    await expect
      .element(dialog.getByRole('button', { name: 'Create custom material' }))
      .toBeVisible();
    expect(dialog.getByLabelText('Manufacturer').query()).toBe(null);
    expect(dialog.getByRole('button', { name: 'Black' }).query()).toBe(null);
    await expect
      .poll(() => lists(stub).at(-1)?.searchParams.get('custom'))
      .toBe('true');
  });

  it('creates a custom material and lands on step 2 with it chosen', async () => {
    const stub = started({
      [`${M}/custom-materials`]: [{ status: 201, body: custom }],
      [`${M}/materials/c1`]: [
        {
          status: 200,
          body: {
            ...row('c1', { name: 'Shed PETG', is_custom: true }),
            custom,
            packages: [],
          },
        },
      ],
    });
    const { dialog } = await open({});
    await dialog
      .getByRole('button', { name: 'Create custom material' })
      .click();
    const create = dialog.getByRole('button', { name: 'Create material' });
    // The manufacturer, the type and the primary colour are still missing.
    await expect.element(create).toBeDisabled();

    // A preset writes the type and its temperatures, and the name follows.
    await dialog.getByRole('button', { name: 'PETG', exact: true }).click();
    await expect
      .element(dialog.getByLabelText('Min nozzle temp'))
      .toHaveValue(220);
    await expect
      .element(dialog.getByRole('combobox', { name: 'Material type' }))
      .toHaveValue('PETG');
    await dialog.getByLabelText('Manufacturer *').fill('Shed');
    await expect
      .element(dialog.getByLabelText('Material name *'))
      .toHaveValue('PETG Shed');
    await dialog.getByLabelText('Material name *').fill('Shed PETG');
    await dialog.getByRole('button', { name: '#E02020' }).click();
    await dialog.getByRole('button', { name: 'Abrasive' }).click();
    await create.click();

    await expect
      .element(dialog.getByRole('button', { name: 'Change material' }))
      .toBeVisible();
    await expect.element(dialog.getByText('Shed PETG')).toBeVisible();
    const post = stub.calls.find((c) => c.url.endsWith('/custom-materials'));
    expect(JSON.parse(post!.body!)).toMatchObject({
      name: 'Shed PETG',
      brand_name: 'Shed',
      type: 'PETG',
      class: 'FFF',
      color_rgba: '#E02020',
      min_print_temp: 220,
      max_chamber_temp: 50,
      density: 1.27,
      tags: ['abrasive'],
      secondary_colors: [],
    });
  });

  it('asks a resin for no type, preset or temperature', async () => {
    started();
    const { dialog } = await open({});
    await dialog
      .getByRole('button', { name: 'Create custom material' })
      .click();
    await expect
      .element(dialog.getByRole('heading', { name: 'Temperature profile' }))
      .toBeVisible();

    await dialog.getByRole('button', { name: 'SLA', exact: true }).click();
    expect(
      dialog.getByRole('heading', { name: 'Temperature profile' }).query(),
    ).toBe(null);
    expect(dialog.getByRole('group', { name: 'Presets' }).query()).toBe(null);
    expect(dialog.getByText('Material type *').query()).toBe(null);
    expect(dialog.getByLabelText('Min nozzle diameter (mm)').query()).toBe(
      null,
    );

    // Without a type to ask for, the manufacturer, a name and a colour do.
    await dialog.getByLabelText('Manufacturer *').fill('Resinco');
    await dialog.getByLabelText('Material name *').fill('Tough Grey');
    await dialog.getByRole('button', { name: '#808080' }).click();
    await expect
      .element(dialog.getByRole('button', { name: 'Create material' }))
      .toBeEnabled();
  });

  it('drops the package and its weights when the material is changed', async () => {
    started({
      [`${M}/materials`]: [
        {
          status: 200,
          body: listing([row('a'), row('b', { name: 'PETG b' })]),
        },
      ],
      [`${M}/materials/b`]: [
        {
          status: 200,
          body: { ...row('b', { name: 'PETG b' }), packages: [] },
        },
      ],
    });
    const { dialog } = await open({});
    await pick();
    await choosePackage();
    await expect
      .element(dialog.getByLabelText('Full weight (g)'))
      .toHaveValue('1200');

    await dialog.getByRole('button', { name: 'Change material' }).click();
    await dialog.getByRole('button', { name: /PETG b/u }).click();
    await expect
      .element(dialog.getByRole('button', { name: 'Continue' }))
      .toBeEnabled();
    await dialog.getByRole('button', { name: 'Continue' }).click();

    await expect
      .element(dialog.getByLabelText('Full weight (g)'))
      .toHaveValue('');
    expect(dialog.getByLabelText('Package').query()).toBe(null);
  });
});

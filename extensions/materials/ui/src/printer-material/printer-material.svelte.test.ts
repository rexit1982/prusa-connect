import type { Device, ReadonlyFleet } from '@prusa/connect-ui/domain';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import setup from '../index';
import PrinterMaterial from './printer-material.svelte';
import { type Answer, type Stub, stubHost } from '../test/host';

// The Tools tab of the printer page, over the module's own setup, as
// the app mounts it in the device-tab slot.

const NS = 'com.github.aux.prusa3d.materials';
const M = `/api/v1/modules/${NS}`;
const TOOLS = `${M}/printers/core/tools`;

const assignment = (extra: Record<string, unknown> = {}) => ({
  device_id: 'core',
  tool_id: '0',
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

/** What a printer reports with no name: the abbreviation and the type only. */
const bare = (extra: Record<string, unknown> = {}) =>
  assignment({
    material_uuid: '',
    material_source: '',
    material_name: '',
    brand_name: '',
    type: 'PETG',
    abbreviation: 'PETG',
    color_rgba: '',
    by: 'printer',
    ...extra,
  });

const reported = (extra: Record<string, unknown> = {}) => ({
  abbreviation: 'PETG',
  instance_uuid: '',
  package_uuid: '',
  material_uuid: '',
  type: 'PETG',
  color_rgba: '',
  ...extra,
});

const tool = (
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  assignment: null,
  reported: null,
  from_nfc: false,
  assign: '',
  unassign: '',
  kind: id.includes('.') ? 'slot' : 'head',
  active: false,
  nozzle: {},
  ...extra,
});

const printer = (
  tools: ReturnType<typeof tool>[],
  extra: Record<string, unknown> = {},
): Answer => ({
  status: 200,
  body: {
    id: 'core',
    name: 'Core One',
    connected: true,
    state: 'IDLE',
    may_operate: true,
    tools,
    ...extra,
  },
});

const row = (uuid: string, spools: number) => ({
  uuid,
  name: `PLA ${uuid}`,
  brand_name: 'Prusament',
  class: 'FFF',
  type: 'PLA',
  color_rgba: '#ff0000ff',
  is_favourite: false,
  is_custom: false,
  spools,
  assigned_spools: 0,
  remaining_g: spools * 400,
  free_g: spools * 400,
});

const detail = (uuid: string, spools: number) => ({
  ...row(uuid, spools),
  material: {
    uuid,
    slug: `pla-${uuid}`,
    brand_slug: 'prusament',
    name: `PLA ${uuid}`,
    class: 'FFF',
    type: 'PLA',
    abbreviation: 'PLA',
    color_rgba: '#ff0000ff',
  },
  packages: [],
});

const spool = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  uuid: `00000000-0000-0000-0000-00000000000${String(id)}`,
  source: 'manual',
  material_uuid: 'a',
  material_source: 'catalogue',
  material_name: 'PLA a',
  brand_name: 'Prusament',
  class: 'FFF',
  type: 'PLA',
  color_rgba: '#ff0000ff',
  full_weight_g: 1000,
  remaining_weight_g: 400,
  location: '',
  notes: '',
  created_by: 'user:demo',
  created_at: '2026-10-28T10:00:00Z',
  updated_at: '2026-10-28T10:00:00Z',
  tool: null,
  ...extra,
});

const refused = (
  status: number,
  code: string,
  params: Record<string, unknown> = {},
): Answer => ({
  status,
  contentType: 'application/problem+json',
  body: { code, status, title: code, detail: 'refused', params },
});

const started = (
  routed: Record<string, readonly Answer[]>,
  fleet?: ReadonlyFleet,
): Stub => {
  const stub = stubHost([{ status: 200, body: {} }], {
    ...(fleet === undefined ? {} : { fleet }),
    routed: {
      [`${M}/catalogue`]: [
        { status: 200, body: { loaded: true, import: { phase: 'idle' } } },
      ],
      [`${M}/types`]: [{ status: 200, body: { types: ['PLA'] } }],
      [`${M}/catalogue/brands`]: [{ status: 200, body: { brands: [] } }],
      [`${M}/locations`]: [{ status: 200, body: { locations: [] } }],
      [`${M}/materials`]: [
        {
          status: 200,
          body: {
            rows: [row('a', 2), row('b', 0)],
            total: 2,
            stock_g: 800,
            stock_spools: 2,
          },
        },
      ],
      [`${M}/materials/a`]: [{ status: 200, body: detail('a', 2) }],
      [`${M}/materials/b`]: [{ status: 200, body: detail('b', 0) }],
      ...routed,
    },
  });
  void setup(stub.host);

  return stub;
};

const draw = async (stub: Stub): Promise<void> => {
  const component = stub.registered.deviceTab.tools;
  expect(component).toBeDefined();
  await render(component!, { deviceId: 'core' });
};

const rows = (): NodeListOf<Element> =>
  document.querySelectorAll('[data-part="tool"]');

const sent = (stub: Stub, method: string): unknown[] =>
  stub.calls
    .filter((c) => c.method === method && c.url.startsWith(`${TOOLS}/`))
    .map((c) =>
      c.body === undefined ? undefined : (JSON.parse(c.body) as unknown),
    );

describe('the material section', () => {
  it('says how many kilograms can still be loaded', async () => {
    started({
      [TOOLS]: [printer([tool('0')])],
      // One of the two spools of a is on a printer.
      [`${M}/materials`]: [
        {
          status: 200,
          body: {
            rows: [
              { ...row('a', 2), assigned_spools: 1, free_g: 400 },
              row('b', 0),
            ],
            total: 2,
            stock_g: 800,
            stock_spools: 2,
          },
        },
      ],
    });
    await render(PrinterMaterial, { deviceId: 'core', compact: true });

    await page.getByTestId('filament-position').click();

    const stocked = page.getByRole('button', { name: /^PLA a/ });
    await expect.element(stocked).toBeVisible();
    expect(stocked.element().textContent).toContain(
      'Prusament · PLA · 1 spool · 0.4 kg available',
    );
    expect(
      page.getByRole('button', { name: /^PLA b/ }).element().textContent,
    ).not.toContain('kg');
  });

  it('selects a catalogue material and spool in the compact header', async () => {
    const stub = started({
      [TOOLS]: [printer([tool('0')])],
      [`${M}/materials/a/spools`]: [
        {
          status: 200,
          body: { spools: [spool(7)], total: 1 },
        },
      ],
      [`${TOOLS}/0`]: [{ status: 200, body: assignment({ spool_id: 7 }) }],
    });
    await render(PrinterMaterial, { deviceId: 'core', compact: true });

    await page.getByTestId('filament-position').click();
    await page.getByRole('button', { name: /^PLA a/ }).click();

    const spoolPicker = page.getByRole('combobox', {
      name: 'Spool',
      exact: true,
    });
    await spoolPicker.click();
    await page.getByRole('option', { name: /Spool #7/ }).click();
    expect(spoolPicker.element().textContent).toContain('Spool #7 · 400');

    await page.getByRole('button', { name: 'Confirm selection' }).click();
    await expect.poll(() => sent(stub, 'PUT')).toEqual([{ spool_id: 7 }]);
  });

  it('lists favourites, then the catalogue, from one search', async () => {
    const stub = started({
      [TOOLS]: [printer([tool('0')])],
      [`${M}/materials`]: [
        {
          status: 200,
          body: {
            rows: [{ ...row('a', 2), is_favourite: true }, row('b', 0)],
            total: 2,
            stock_g: 800,
            stock_spools: 2,
          },
        },
      ],
    });
    await render(PrinterMaterial, { deviceId: 'core', compact: true });

    await page.getByTestId('filament-position').click();
    await page.getByRole('searchbox').fill('Prusa');

    await expect
      .element(page.getByRole('heading', { name: 'Favourites' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('heading', { name: 'Catalogue' }))
      .toBeVisible();
    const buttons = [
      ...document.querySelectorAll(
        '[data-part="header-material-assignment"] button',
      ),
    ].map((b) => b.textContent.trim());
    expect(buttons[0]).toContain('Use printer reading');
    expect(buttons.findIndex((x) => x.startsWith('PLA a'))).toBeLessThan(
      buttons.findIndex((x) => x.startsWith('PLA b')),
    );

    const asked = stub.calls
      .map((c) => new URL(c.url, 'http://x'))
      .filter((u) => u.pathname === `${M}/materials`);
    const searched = asked.filter((u) => u.searchParams.get('q') === 'Prusa');
    expect(searched).toHaveLength(1);
    expect(searched[0]!.searchParams.has('favourites')).toBe(false);
    expect(searched[0]!.searchParams.has('in_stock')).toBe(false);
    expect(
      page.getByRole('button', { name: 'Full catalogue' }).query(),
    ).toBeNull();
    expect(page.getByRole('tab').query()).toBeNull();
  });

  it('previews five catalogue rows until asked, searched or filtered', async () => {
    const stub = started({
      [TOOLS]: [printer([tool('0')])],
      [`${M}/materials`]: [
        {
          status: 200,
          body: {
            rows: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((u) => row(u, 0)),
            total: 7,
            stock_g: 0,
            stock_spools: 0,
          },
        },
      ],
    });
    await render(PrinterMaterial, { deviceId: 'core', compact: true });

    await page.getByTestId('filament-position').click();
    const names = (): string[] =>
      [
        ...document.querySelectorAll(
          '[data-part="header-material-assignment"] .choice > button:first-child',
        ),
      ].map((b) => b.textContent.trim());
    await expect.poll(() => names().length).toBe(6);
    expect(names()[5]).toContain('PLA e');

    await page.getByRole('button', { name: 'Show more' }).click();
    await expect.poll(() => names().length).toBe(8);
    expect(page.getByRole('button', { name: 'Show more' }).query()).toBeNull();

    // The colour wheel and the selects are on screen without opening anything.
    await page.getByRole('button', { name: 'Black' }).click();
    await expect
      .poll(() =>
        stub.calls.some(
          (c) =>
            new URL(c.url, 'http://x').searchParams.get('color') === 'black',
        ),
      )
      .toBe(true);
    await expect
      .element(page.getByRole('button', { name: 'Black' }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect
      .element(page.getByRole('button', { name: 'Clear filters' }))
      .toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect
      .element(page.getByRole('button', { name: 'Black' }))
      .toHaveAttribute('aria-pressed', 'false');
  });

  it('stars a material from its row', async () => {
    const stub = started({
      [TOOLS]: [printer([tool('0')])],
      [`${M}/favourites/b`]: [{ status: 204, body: undefined }],
    });
    await render(PrinterMaterial, { deviceId: 'core', compact: true });

    await page.getByTestId('filament-position').click();
    const star = page.getByRole('button', { name: 'Favourite: PLA b' });
    await star.click();

    await expect
      .poll(() =>
        stub.calls.some(
          (c) => c.method === 'PUT' && c.url === `${M}/favourites/b`,
        ),
      )
      .toBe(true);
    await expect.element(star).toHaveAttribute('aria-pressed', 'true');
    await expect
      .element(page.getByRole('heading', { name: 'Favourites' }))
      .toBeVisible();
  });

  it('gives the tool back to the printer reading', async () => {
    const stub = started({
      [TOOLS]: [
        printer([
          tool('0', { assignment: assignment(), reported: reported() }),
        ]),
      ],
      [`${TOOLS}/0`]: [{ status: 204, body: undefined }],
    });
    await render(PrinterMaterial, { deviceId: 'core', compact: true });

    await page.getByTestId('filament-position').click();
    const confirm = page.getByRole('button', { name: 'Confirm selection' });
    await page.getByRole('button', { name: /^Use printer reading/ }).click();
    await confirm.click();

    await expect.poll(() => sent(stub, 'DELETE')).toEqual([undefined]);
  });

  it('keeps Confirm off while the tool already follows the printer', async () => {
    started({ [TOOLS]: [printer([tool('0', { reported: reported() })])] });
    await render(PrinterMaterial, { deviceId: 'core', compact: true });

    await page.getByTestId('filament-position').click();

    await expect
      .element(page.getByRole('button', { name: 'Confirm selection' }))
      .toBeDisabled();
  });

  // A reason the module may add later is not a filament change.
  it('gives a refusal it does not know the generic reason in the compact header', async () => {
    started({
      [TOOLS]: [printer([tool('0', { assign: 'something-new' })])],
    });
    await render(PrinterMaterial, { deviceId: 'core', compact: true });

    await expect
      .element(page.getByTestId('filament-position'))
      .toHaveAttribute(
        'title',
        "The material on this tool cannot be changed in the printer's current state.",
      );
  });

  // A cell of the Tools table holds the chip of its own tool, and the plain
  // reading stands in for a tool the module does not list.
  it('draws only the chip of the tool a table cell asks for', async () => {
    started({ [TOOLS]: [printer([tool('0'), tool('1')])] });
    await render(PrinterMaterial, {
      deviceId: 'core',
      compact: true,
      toolId: '1',
      fallback: createRawSnippet(() => ({
        render: () => '<span>plain</span>',
      })),
    });

    await expect
      .element(page.getByTestId('filament-position'))
      .toHaveAttribute('data-tool', '1');
    expect(page.getByTestId('filament-position').elements()).toHaveLength(1);
  });

  it('falls back to the plain reading for a tool it does not list', async () => {
    started({ [TOOLS]: [printer([tool('0')])] });
    await render(PrinterMaterial, {
      deviceId: 'core',
      compact: true,
      toolId: '7',
      fallback: createRawSnippet(() => ({
        render: () => '<span>plain</span>',
      })),
    });

    await expect.element(page.getByText('plain')).toBeVisible();
  });

  it('draws one row per tool, with what is on it', async () => {
    const stub = started({
      [TOOLS]: [
        printer([
          tool('0', { assignment: assignment({ spool_id: 7 }) }),
          tool('0.1', {
            assignment: bare({ tool_id: '0.1' }),
            reported: reported(),
          }),
        ]),
      ],
      [`${M}/materials/a/spools`]: [
        {
          status: 200,
          body: {
            spools: [
              spool(7, {
                remaining_weight_g: 400,
                tool: { device_id: 'core', tool_id: '0' },
              }),
            ],
            total: 1,
          },
        },
      ],
    });
    await draw(stub);

    await expect.element(page.getByText('Galaxy Black')).toBeVisible();
    expect(rows()).toHaveLength(2);
    await expect.element(page.getByText('Tool 1')).toBeVisible();
    await expect
      .element(page.getByText('Slot 2', { exact: true }))
      .toBeVisible();
    // A spool on the tool is marked and weighed; a bare report names no
    // material, and its circle shows the type.
    await expect.element(page.getByTitle('From Materials')).toBeVisible();
    await expect.element(page.getByText('No material assigned')).toBeVisible();
    await expect.element(page.getByText('400 / 1,000 g')).toBeVisible();
    await expect
      .element(page.getByText('PETG', { exact: true }).first())
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Change' }).first())
      .toBeEnabled();
  });

  it('shows what is left of the one tool of a printer and unloads it', async () => {
    const stub = started({
      [TOOLS]: [
        printer([
          tool('0', {
            assignment: assignment({ spool_id: 7 }),
            reported: reported({ abbreviation: 'PLA', type: 'PLA' }),
            nozzle: { diameter_mm: 0.4, high_flow: true, hardened: false },
          }),
        ]),
      ],
      [`${M}/materials/a/spools`]: [
        {
          status: 200,
          body: {
            spools: [spool(7, { remaining_weight_g: 967 })],
            total: 1,
          },
        },
      ],
      '/api/v1/devices/core/commands': [{ status: 200, body: { ok: true } }],
    });
    await draw(stub);

    await expect.element(page.getByText('Extruder')).toBeVisible();
    await expect.element(page.getByText('967 / 1,000 g')).toBeVisible();
    // The Tools table of the printer page shows the nozzle and its flags.
    await expect
      .element(page.getByText('Tool settings'))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByText('Material details'))
      .not.toBeInTheDocument();

    await page.getByRole('button', { name: 'Unload' }).click();
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

  it('offers Unload on the active tool of several, as the printer unloads that one', async () => {
    const stub = started({
      [TOOLS]: [
        printer(
          ['0', '1', '2'].map((id) =>
            tool(id, {
              reported: reported({ abbreviation: 'PLA' }),
              active: id === '1',
            }),
          ),
        ),
      ],
    });
    await draw(stub);

    await expect
      .element(page.getByRole('button', { name: 'Unload' }))
      .toBeEnabled();
    expect(rows()).toHaveLength(3);
    expect(page.getByRole('button', { name: 'Unload' }).all()).toHaveLength(1);
    expect(document.querySelector('[data-tool="1"]')?.textContent).toContain(
      'Unload',
    );
  });

  it('offers Unassign and no Assign while the printer is not connected', async () => {
    const stub = started({
      [TOOLS]: [
        printer([tool('0', { assignment: assignment() })], {
          connected: false,
          state: '',
        }),
      ],
    });
    await draw(stub);

    await expect
      .element(page.getByRole('button', { name: 'Unassign' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Change' }))
      .not.toBeInTheDocument();
  });

  it('draws the five slots of an MMU printer, and not its head', async () => {
    // GET /printers/{device}/tools leaves out a head that carries a feeder.
    const stub = started({
      [TOOLS]: [
        printer(['0.0', '0.1', '0.2', '0.3', '0.4'].map((id) => tool(id))),
      ],
    });
    await draw(stub);

    for (const n of [1, 2, 3, 4, 5]) {
      await expect
        .element(page.getByText(`Slot ${String(n)}`, { exact: true }))
        .toBeVisible();
    }
    expect(rows()).toHaveLength(5);
    // One header for the MMU, with one Unload filament for the head.
    await expect.element(page.getByText('MMU', { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Unload filament' }))
      .toBeDisabled();
    await expect.element(page.getByText('Tool 1')).not.toBeInTheDocument();
  });

  it("gives the MMU's Unload filament the generic reason for a refusal it does not know", async () => {
    const stub = started({
      [TOOLS]: [
        printer([
          tool('0.0', { unassign: 'something-new' }),
          ...['0.1', '0.2'].map((id) => tool(id)),
        ]),
      ],
    });
    await draw(stub);

    await expect
      .element(page.getByRole('button', { name: 'Unload filament' }))
      .toBeDisabled();
    await expect
      .element(
        page.getByText(
          "The material on this tool cannot be changed in the printer's current state.",
        ),
      )
      .toBeInTheDocument();
  });

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
    const assigned = tool('0', { assignment: assignment() });
    const stub = started(
      {
        [TOOLS]: [
          printer([assigned]),
          printer([{ ...assigned, assign: 'printing', unassign: 'printing' }], {
            state: 'PRINTING',
          }),
        ],
      },
      fleet,
    );
    await draw(stub);
    await expect
      .element(page.getByRole('button', { name: 'Change' }))
      .toBeEnabled();

    live.devices = [
      { id: 'core', connected: true, state: { '/state': 'PRINTING' } },
    ] as unknown as Device[];

    await expect
      .element(page.getByText(/Cannot assign material while printing/))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: 'Change' }))
      .toBeDisabled();
    expect(stub.calls.filter((c) => c.url === TOOLS)).toHaveLength(2);
  });

  it('keeps the newer weight of a spool when an older read lands late', async () => {
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
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const weighing = (g: number, wait?: Promise<unknown>): Answer => ({
      status: 200,
      body: { spools: [spool(7, { remaining_weight_g: g })], total: 1 },
      ...(wait === undefined ? {} : { held: wait }),
    });
    const stub = started(
      {
        [TOOLS]: [
          printer([tool('0', { assignment: assignment({ spool_id: 7 }) })]),
        ],
        [`${M}/materials/a/spools`]: [weighing(400, held), weighing(300)],
      },
      fleet,
    );
    await draw(stub);

    live.devices = [
      { id: 'core', connected: true, state: { '/state': 'BUSY' } },
    ] as unknown as Device[];
    await expect.element(page.getByText('300 / 1,000 g')).toBeVisible();

    release();
    await expect
      .poll(() => stub.calls.filter((c) => c.url.includes('/spools')).length)
      .toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect.element(page.getByText('300 / 1,000 g')).toBeVisible();
  });

  it('draws nothing for a printer the person may not observe', async () => {
    const stub = started({
      [TOOLS]: [refused(404, 'materials/NOT_FOUND')],
    });
    await draw(stub);

    // The reading skeleton is drawn first, so this waits for the answer.
    await expect
      .poll(() => document.querySelector('[data-part="printer-tools"]'))
      .toBe(null);
    expect(stub.calls.map((c) => c.url)).toEqual([TOOLS]);
  });

  it('says why a change is refused while printing and off a tag', async () => {
    const stub = started({
      [TOOLS]: [
        printer(
          [
            tool('0', {
              assignment: assignment(),
              reported: reported({ abbreviation: 'PLA' }),
              assign: 'printing',
              unassign: 'printing',
              active: true,
            }),
            tool('1', {
              assignment: bare({ tool_id: '1', abbreviation: 'PLA' }),
              reported: reported({ abbreviation: 'PLA', instance_uuid: 't' }),
              from_nfc: true,
              assign: 'nfc',
            }),
          ],
          { state: 'PRINTING' },
        ),
      ],
    });
    await draw(stub);

    // The reasons are behind each tile's info mark.
    await expect
      .element(page.getByText(/Cannot assign material while printing/))
      .toBeInTheDocument();
    await expect
      .element(page.getByText(/Cannot unload while printing/))
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText('Cannot change a material read from the spool NFC tag'),
      )
      .toBeInTheDocument();
    await expect
      .element(page.getByTitle('Read from the spool NFC tag by the printer'))
      .toBeVisible();
    for (const button of page.getByRole('button', { name: 'Change' }).all()) {
      await expect.element(button).toBeDisabled();
    }
    // A connected printer's head unloads rather than unassigns.
    await expect
      .element(page.getByRole('button', { name: 'Unload' }))
      .toBeDisabled();
    await expect
      .element(page.getByRole('button', { name: 'Unassign' }))
      .not.toBeInTheDocument();
  });

  it('names the state a busy refusal comes from when it is not a filament change', async () => {
    const stub = started({
      [TOOLS]: [
        printer([tool('0', { assign: 'busy', unassign: 'busy' })], {
          state: 'ATTENTION',
        }),
      ],
    });
    await draw(stub);

    await expect
      .element(
        page.getByText('Material cannot be changed in printer state Attention'),
      )
      .toBeVisible();
  });

  it('opens the header chip picker in a dialog and assigns the spool picked', async () => {
    const stub = started({
      [TOOLS]: [printer([tool('0')])],
      [`${TOOLS}/0`]: [{ status: 200, body: assignment({ spool_id: 7 }) }],
      [`${M}/materials/a/spools`]: [
        { status: 200, body: { spools: [spool(7)], total: 1 } },
      ],
    });
    await draw(stub);

    await page.getByRole('button', { name: 'Assign' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^PLA a/ }).click();
    await dialog.getByRole('combobox', { name: 'Spool', exact: true }).click();
    await page.getByRole('option', { name: /Spool #7/ }).click();
    await dialog.getByRole('button', { name: 'Confirm selection' }).click();

    await expect.poll(() => sent(stub, 'PUT')).toEqual([{ spool_id: 7 }]);
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('adds an unknown NFC spool to Materials once', async () => {
    const nfc = tool('0', {
      assignment: bare({ abbreviation: 'PLA', type: 'PLA' }),
      reported: reported({ abbreviation: 'PLA', instance_uuid: 'tag-1' }),
      from_nfc: true,
      assign: 'nfc',
    });
    const known = {
      ...nfc,
      assignment: assignment({ spool_id: 9, by: 'printer' }),
    };
    const stub = started({
      [TOOLS]: [printer([nfc]), printer([known])],
      [`${TOOLS}/0/spool`]: [{ status: 200, body: spool(9) }],
    });
    await draw(stub);

    const add = page.getByRole('button', { name: 'Add to Materials' });
    await add.dblClick();

    await expect.element(add).not.toBeInTheDocument();
    expect(
      stub.calls.filter(
        (c) => c.method === 'POST' && c.url.endsWith('/tools/0/spool'),
      ),
    ).toHaveLength(1);
  });

  it('shows a non-operator the controls disabled, and why', async () => {
    const stub = started({
      [TOOLS]: [
        printer(
          [
            tool('0', { assignment: assignment() }),
            tool('1', {
              assignment: bare({ tool_id: '1' }),
              reported: reported({ instance_uuid: 'tag-2' }),
              from_nfc: true,
            }),
          ],
          { may_operate: false },
        ),
      ],
    });
    await draw(stub);

    await expect
      .element(
        page.getByText('You need permission to operate this printer').first(),
      )
      .toBeVisible();
    for (const name of ['Change', 'Unassign', 'Add to Materials']) {
      for (const button of page.getByRole('button', { name }).all()) {
        await expect.element(button).toBeDisabled();
      }
    }
  });
});

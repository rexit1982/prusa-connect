import { beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import setup from '../index';
import { type Answer, gate, type Stub, stubHost } from '../test/host';

// The whole module, driven the way the app drives it: the stub host runs the
// bundle's own setup, which registers the page each case renders.

const NS = 'com.github.aux.prusa3d.materials';
const MATERIALS = `/api/v1/modules/${NS}/materials`;

const row = (uuid: string, extra: Record<string, unknown> = {}) => ({
  uuid,
  name: `PLA ${uuid}`,
  brand_name: 'Prusament',
  class: 'FFF',
  type: 'PLA',
  color_rgba: '#ff0000ff',
  is_favourite: false,
  is_custom: false,
  spools: 2,
  assigned_spools: 0,
  remaining_g: 500,
  free_g: 500,
  ...extra,
});

const listing = (rows: ReturnType<typeof row>[], extra = {}) => ({
  rows,
  total: rows.length,
  stock_g: 1500,
  stock_spools: 3,
  ...extra,
});

const started = (
  body: unknown,
  {
    routed,
    ...options
  }: {
    mayOperate?: boolean;
    until?: Promise<unknown>;
    routed?: Record<string, readonly Answer[]>;
  } = {},
): Stub => {
  const stub = stubHost([{ status: 200, body: {} }], {
    ...options,
    routed: {
      [`/api/v1/modules/${NS}/list-filters`]: [
        { status: 200, body: { filters: {} } },
      ],
      [MATERIALS]: [{ status: 200, body }],
      [`/api/v1/modules/${NS}/catalogue/brands`]: [
        {
          status: 200,
          body: {
            brands: [{ uuid: 'b1', slug: 'prusament', name: 'Prusament' }],
          },
        },
      ],
      [`/api/v1/modules/${NS}/types`]: [
        { status: 200, body: { types: ['ASA', 'PETG', 'PLA'] } },
      ],
      [`/api/v1/modules/${NS}/locations`]: [
        {
          status: 200,
          body: { locations: [{ id: 7, name: 'Shelf A', spools: 2 }] },
        },
      ],
      [`/api/v1/modules/${NS}/favourites/a`]: [{ status: 204, body: null }],
      ...routed,
    },
  });
  void setup(stub.host);

  return stub;
};

const draw = async (stub: Stub): Promise<void> => {
  const component = stub.registered.pages.materials;
  expect(component).toBeDefined();
  await render(component!);
};

const lastList = (stub: Stub): URL =>
  new URL(
    stub.calls.filter((c) => /\/materials(\?|$)/.test(c.url)).at(-1)!.url,
    'http://x',
  );

describe('the materials page', () => {
  // The extension's sheet carries the library's container queries, which fold
  // the toolbar's facets into one Filters button below 28rem. The default
  // 414px page is under that, and these cases drive the facets themselves.
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });

  it('shows Add material to a person who may operate and hides it from one who may not', async () => {
    const yes = started(listing([row('a')]));
    await draw(yes);
    await expect
      .element(page.getByRole('button', { name: 'Add material' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByText('1.5 kg in stock · 3 spools'))
      .toBeInTheDocument();
  });

  it('counts one spool in stock in the singular', async () => {
    await draw(started(listing([row('a')], { stock_spools: 1 })));
    await expect
      .element(page.getByText('1.5 kg in stock · 1 spool', { exact: true }))
      .toBeInTheDocument();
  });

  it('leaves Add material and + away for a person who may not operate', async () => {
    const no = started(listing([row('a')]), { mayOperate: false });
    await draw(no);
    await expect.element(page.getByText('PLA a')).toBeInTheDocument();
    await expect
      .element(
        page.getByText('You can look at the materials but not change them.'),
      )
      .toBeInTheDocument();
    expect(page.getByRole('button', { name: 'Add material' }).query()).toBe(
      null,
    );
    expect(
      page.getByRole('button', { name: 'Add spools of PLA a' }).query(),
    ).toBe(null);
  });

  it('asks for the filter, the class and the search the person chose', async () => {
    const stub = started(listing([row('a')]));
    await draw(stub);
    await expect.element(page.getByText('PLA a')).toBeInTheDocument();

    await page.getByRole('button', { name: 'Printing technology' }).click();
    await page.getByRole('button', { name: 'Resin' }).click();
    await expect
      .poll(() => lastList(stub).searchParams.get('class'))
      .toBe('SLA');

    const search = page.getByLabelText('Search', { exact: true });
    await search.fill('pet');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => lastList(stub).searchParams.get('q')).toBe('pet');

    await page.getByRole('button', { name: 'Favourites' }).click();
    await page.getByRole('button', { name: 'On a printer' }).click();
    await expect
      .poll(() => lastList(stub).searchParams.get('assigned'))
      .toBe('true');
    expect(lastList(stub).searchParams.get('favourites')).toBe('true');
    expect(lastList(stub).searchParams.get('in_stock')).toBe('true');
    expect(lastList(stub).searchParams.get('class')).toBe('SLA');
    expect(lastList(stub).searchParams.get('q')).toBe('pet');
  });

  it('counts the spools on a printer beside a printer', async () => {
    await draw(
      started(
        listing([
          row('a', { spools: 3, assigned_spools: 1 }),
          row('b', { spools: 2 }),
        ]),
      ),
    );
    const on = page
      .getByRole('row')
      .filter({ hasText: 'PLA a' })
      .getByText('1 spool on a printer');
    await expect.element(on).toBeInTheDocument();
    on.element().closest<HTMLElement>('[data-part="tap-tooltip"]')!.click();
    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent('1 spool on a printer');
    expect(
      page
        .getByRole('row')
        .filter({ hasText: 'PLA b' })
        .getByText(/on a printer/u)
        .query(),
    ).toBe(null);
  });

  it('hides the type filter for resins, and lets the type go', async () => {
    const stub = started(listing([row('a')]));
    await draw(stub);
    await expect.element(page.getByText('PLA a')).toBeInTheDocument();
    await page.getByRole('button', { name: 'Type' }).click();
    await page.getByRole('button', { name: 'PETG', exact: true }).click();
    await expect
      .poll(() => lastList(stub).searchParams.get('type'))
      .toBe('PETG');

    await page.getByRole('button', { name: 'Printing technology' }).click();
    await page.getByRole('button', { name: 'Resin' }).click();
    await expect
      .poll(() => lastList(stub).searchParams.get('class'))
      .toBe('SLA');
    expect(lastList(stub).searchParams.get('type')).toBe(null);
    expect(page.getByRole('button', { name: 'Type' }).query()).toBe(null);

    await page.getByRole('button', { name: /Printing technology/ }).click();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect
      .element(page.getByRole('button', { name: 'Type' }))
      .toBeInTheDocument();
  });

  it('sorts by what the person picks, in the direction it names', async () => {
    const stub = started(listing([row('a')]));
    await draw(stub);
    await expect.element(page.getByText('PLA a')).toBeInTheDocument();
    await page.getByRole('combobox', { name: 'Sort by' }).click();
    await page.getByRole('option', { name: 'Most in stock' }).click();
    await expect
      .poll(() => lastList(stub).searchParams.get('order'))
      .toBe('weight');
    expect(lastList(stub).searchParams.get('desc')).toBe('true');
  });

  it('opens the material from anywhere on its row, past its own controls', async () => {
    const stub = started(listing([row('a')]));
    await draw(stub);
    const at = (element: Element): Element | null => {
      const box = element.getBoundingClientRect();
      return document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
    };
    await expect.element(page.getByText('PLA a')).toBeInTheDocument();
    const tr = page.getByRole('row').filter({ hasText: 'PLA a' });
    const brand = tr.getByText('Prusament').element();

    expect(at(brand)?.closest('a')?.getAttribute('href')).toBe(
      stub.host.pageHref('material') + '?uuid=a',
    );
    const star = tr.getByRole('button', { name: 'Star PLA a' }).element();
    expect(star.contains(at(star))).toBe(true);
  });

  it("opens the add dialog on a row's material from its +", async () => {
    const stub = started(listing([row('a')]));
    await draw(stub);
    await page.getByRole('button', { name: 'Add spools of PLA a' }).click();
    await expect.element(page.getByRole('dialog')).toBeVisible();
    await expect
      .poll(() => stub.calls.some((c) => c.url.endsWith('/materials/a')))
      .toBe(true);
  });

  it('opens with the filters the person kept, and keeps each change', async () => {
    const stub = started(listing([row('a')]), {
      routed: {
        [`/api/v1/modules/${NS}/list-filters`]: [
          { status: 200, body: { filters: { in_stock: true, limit: 3 } } },
          { status: 204, body: null },
        ],
      },
    });
    await draw(stub);
    await expect
      .poll(() => lastList(stub).searchParams.get('in_stock'))
      .toBe('true');
    // Only what the page keeps comes back from the module.
    expect(lastList(stub).searchParams.has('limit')).toBe(false);
    expect(stub.calls.some((c) => c.method === 'PUT')).toBe(false);

    await page.getByRole('button', { name: 'Favourites' }).click();
    await expect
      .poll(() => stub.calls.find((c) => c.method === 'PUT')?.body)
      .toBe(JSON.stringify({ favourites: true, in_stock: true }));
  });

  it('opens on the shelf for a person who kept nothing and has spools', async () => {
    const stub = started(listing([row('a')]));
    await draw(stub);
    await expect.element(page.getByText('PLA a')).toBeInTheDocument();
    expect(lastList(stub).searchParams.get('in_stock')).toBe('true');
  });

  it('opens on the catalogue for a person who kept nothing and has no spools', async () => {
    const stub = started(listing([row('a')], { stock_g: 0, stock_spools: 0 }));
    await draw(stub);
    await expect.element(page.getByText('PLA a')).toBeInTheDocument();
    await expect.poll(() => lastList(stub).search).toBe('');
  });

  it('makes a custom material from Custom material and reads the list again', async () => {
    const stub = started(listing([row('a')]), {
      routed: {
        [`/api/v1/modules/${NS}/custom-materials`]: [
          {
            status: 201,
            body: {
              uuid: 'c1',
              name: 'PLA Acme',
              brand_name: 'Acme',
              class: 'FFF',
              type: 'PLA',
              abbreviation: '',
              color_rgba: '#2762ED',
              ral_code: '',
              secondary_colors: [],
              certifications: [],
              tags: [],
              created_at: '2026-10-29T10:00:00Z',
              updated_at: '2026-10-29T10:00:00Z',
            },
          },
        ],
      },
    });
    await draw(stub);
    await expect.element(page.getByText('PLA a')).toBeInTheDocument();
    const reads = (): number =>
      stub.calls.filter((c) => /\/materials(\?|$)/.test(c.url)).length;
    const before = reads();

    await page.getByRole('button', { name: 'Custom material' }).click();
    const dialog = page.getByRole('dialog');
    await expect
      .element(dialog.getByRole('heading', { name: 'Create custom material' }))
      .toBeVisible();
    await dialog.getByRole('button', { name: 'PLA', exact: true }).click();
    await dialog.getByLabelText('Manufacturer *').fill('Acme');
    await dialog.getByRole('button', { name: '#2762ED' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    const post = stub.calls.find((c) => c.url.endsWith('/custom-materials'));
    expect(JSON.parse(post!.body!)).toMatchObject({
      name: 'PLA Acme',
      brand_name: 'Acme',
      type: 'PLA',
      color_rgba: '#2762ED',
    });
    expect(reads()).toBeGreaterThan(before);
  });

  it('links a row to the material page', async () => {
    const stub = started(listing([row('a')]));
    await draw(stub);
    const link = page.getByRole('link', { name: 'PLA a' });
    await expect
      .element(link)
      .toHaveAttribute('href', stub.host.pageHref('material') + '?uuid=a');
  });

  it('measures each row against its own spools, and draws no bar without a full weight', async () => {
    const stub = started(
      listing([
        row('a', { spools: 2, remaining_g: 800, capacity_g: 2000 }),
        row('b', { spools: 1, remaining_g: 300 }),
      ]),
    );
    await draw(stub);

    const bar = page.getByRole('progressbar', {
      name: 'What is left of PLA a',
    });
    await expect.element(bar).toHaveAttribute('aria-valuenow', '800');
    await expect.element(bar).toHaveAttribute('aria-valuemax', '2000');
    await expect.element(page.getByText('0.8 / 2 kg')).toBeVisible();
    await expect.element(page.getByText('0.3 kg')).toBeVisible();
    await expect
      .element(page.getByRole('progressbar', { name: 'What is left of PLA b' }))
      .not.toBeInTheDocument();
  });

  it('toggles a star', async () => {
    const stub = started(listing([row('a')]));
    await draw(stub);
    const star = page.getByRole('button', { name: 'Star PLA a' });
    await expect.element(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
    await expect.element(star).toHaveAttribute('aria-pressed', 'true');
    expect(
      stub.calls.some(
        (c) => c.url.endsWith('/favourites/a') && c.method === 'PUT',
      ),
    ).toBe(true);
  });

  it('invites the first spool when the module keeps none', async () => {
    const stub = started(listing([], { stock_g: 0, stock_spools: 0 }));
    await draw(stub);
    await expect.element(page.getByText('No spools yet')).toBeInTheDocument();
    const add = page.getByRole('button', { name: 'Add material' });
    await expect.poll(() => add.elements().length).toBe(2);
  });

  it('offers no add action in the empty state to a person who may not write', async () => {
    const stub = started(listing([], { stock_g: 0, stock_spools: 0 }), {
      mayOperate: false,
    });
    await draw(stub);
    await expect.element(page.getByText('No spools yet')).toBeInTheDocument();
    expect(page.getByRole('button', { name: 'Add material' }).query()).toBe(
      null,
    );
  });

  it('narrows the manufacturer and the type by what is typed, and clears them', async () => {
    const stub = started(listing([row('a')]));
    await draw(stub);
    await expect.element(page.getByText('PLA a')).toBeInTheDocument();
    const pick = async (facet: string, typed: string, label: string) => {
      await page.getByRole('button', { name: facet }).click();
      await page
        .getByLabelText(`${facet} options`)
        .getByPlaceholder('Search…')
        .fill(typed);
      await expect
        .element(page.getByRole('button', { name: 'ASA' }))
        .not.toBeInTheDocument();
      await page.getByRole('button', { name: label, exact: true }).click();
    };

    await pick('Manufacturer', 'prus', 'Prusament');
    await expect
      .poll(() => lastList(stub).searchParams.get('brand'))
      .toBe('prusament');

    await pick('Type', 'pe', 'PETG');
    await expect
      .poll(() => lastList(stub).searchParams.get('type'))
      .toBe('PETG');
    expect(lastList(stub).searchParams.get('brand')).toBe('prusament');

    await pick('Location', 'shel', 'Shelf A');
    await expect
      .poll(() => lastList(stub).searchParams.get('location'))
      .toBe('7');

    await page.getByRole('button', { name: 'Colour' }).click();
    await page.getByRole('button', { name: 'Blue', exact: true }).click();
    await expect
      .poll(() => lastList(stub).searchParams.get('color'))
      .toBe('blue');

    await page.getByRole('button', { name: 'My custom' }).click();
    await expect
      .poll(() => lastList(stub).searchParams.get('custom'))
      .toBe('true');

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect.poll(() => lastList(stub).search).toBe('');
    expect(page.getByRole('button', { name: 'Clear filters' }).query()).toBe(
      null,
    );
  });

  it('reads once per search, once to clear it and once to clear the filters', async () => {
    const stub = started(listing([row('a')]));
    await draw(stub);
    await expect.element(page.getByText('PLA a')).toBeInTheDocument();
    const reads = () =>
      stub.calls.filter((c) => /\/materials(\?|$)/.test(c.url)).length;
    const before = reads();

    await page.getByLabelText('Search', { exact: true }).fill('pet');
    expect(reads()).toBe(before);
    await userEvent.keyboard('{Enter}');
    await expect.poll(reads).toBe(before + 1);

    await page.getByRole('button', { name: 'Favourites' }).click();
    await expect.poll(reads).toBe(before + 2);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect.poll(reads).toBe(before + 3);
    expect(lastList(stub).searchParams.get('q')).toBe('pet');
    expect(lastList(stub).searchParams.get('favourites')).toBe(null);

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect.poll(reads).toBe(before + 4);
    expect(lastList(stub).searchParams.get('q')).toBe(null);
  });

  it('says the filter matched nothing', async () => {
    const stub = started(listing([]));
    await draw(stub);
    await page.getByRole('button', { name: 'Printing technology' }).click();
    await page.getByRole('button', { name: 'Filament' }).click();
    await expect
      .element(page.getByRole('heading', { name: 'Nothing matches' }))
      .toBeInTheDocument();
    expect(page.getByText('No spools yet').query()).toBe(null);
    await expect
      .element(
        page.getByText(
          'No material matches this filter. Widen it to see more.',
        ),
      )
      .toBeInTheDocument();
  });

  it('offers Show more after Next and appends the page', async () => {
    const stub = stubHost([{ status: 200, body: {} }], {
      routed: {
        [`/api/v1/modules/${NS}/catalogue/brands`]: [
          { status: 200, body: { brands: [] } },
        ],
        [`/api/v1/modules/${NS}/types`]: [{ status: 200, body: { types: [] } }],
        [`/api/v1/modules/${NS}/locations`]: [
          { status: 200, body: { locations: [] } },
        ],
        [MATERIALS]: [
          { status: 200, body: listing([row('a')], { next: 1, total: 2 }) },
          { status: 200, body: listing([row('b')], { total: 2 }) },
        ],
      },
    });
    void setup(stub.host);
    await draw(stub);
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect.element(page.getByText('PLA b')).toBeInTheDocument();
    await expect.element(page.getByText('PLA a')).toBeInTheDocument();
    expect(page.getByRole('button', { name: 'Show more' }).query()).toBe(null);
  });

  it('shows the skeleton while reading', async () => {
    const shut = gate();
    const stub = started(listing([row('a')]), { until: shut.held });
    await draw(stub);
    await expect
      .element(page.getByRole('status', { name: 'Reading the materials' }))
      .toBeInTheDocument();
    shut.open();
    await expect.element(page.getByText('PLA a')).toBeInTheDocument();
  });
});

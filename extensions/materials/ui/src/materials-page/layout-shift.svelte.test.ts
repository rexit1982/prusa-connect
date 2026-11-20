import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import setup from '../index';
import { gate, stubHost } from '../test/host';

// Does the page move when the data arrives. Boxes are measured in a real
// Chromium at a phone width and a laptop width, while the read is in flight
// and after it lands.

const MATERIALS = '/api/v1/modules/com.github.aux.prusa3d.materials/materials';

const LISTING = {
  rows: [1, 2, 3, 4, 5].map((n) => ({
    uuid: 'm' + String(n),
    name: 'PLA ' + String(n),
    brand_name: 'Prusament',
    class: 'FFF',
    type: 'PLA',
    color_rgba: '#ff0000ff',
    is_favourite: false,
    is_custom: false,
    spools: n,
    assigned_spools: 0,
    remaining_g: n * 100,
    free_g: n * 100,
  })),
  total: 5,
  stock_g: 0,
  stock_spools: 0,
};

interface Placed {
  top: number;
  height: number;
}

const placed = (selector: string): Placed => {
  const found = document.querySelector(selector);
  expect(found, `nothing matched ${selector}`).not.toBe(null);
  const box = found!.getBoundingClientRect();

  return { top: Math.round(box.top), height: Math.round(box.height) };
};

const measured = () => ({
  header: placed('[data-slot="page-header"]'),
  listing: placed('[data-part="listing"]'),
});

const shiftAt = async (width: number) => {
  await page.viewport(width, 900);

  const shut = gate();
  const stub = stubHost([{ status: 200, body: {} }], {
    until: shut.held,
    routed: {
      [MATERIALS]: [{ status: 200, body: LISTING }],
      [MATERIALS.replace('/materials', '/catalogue/brands')]: [
        { status: 200, body: { brands: [] } },
      ],
      [MATERIALS.replace('/materials', '/types')]: [
        { status: 200, body: { types: [] } },
      ],
      [MATERIALS.replace('/materials', '/locations')]: [
        { status: 200, body: { locations: [] } },
      ],
    },
  });
  void setup(stub.host);
  await render(stub.registered.pages.materials!);

  await expect
    .element(page.getByRole('status', { name: 'Reading the materials' }))
    .toBeInTheDocument();
  const before = measured();

  shut.open();
  await expect.element(page.getByText('PLA 1').first()).toBeInTheDocument();

  return { before, after: measured() };
};

/** One table row, so a height that changes by less than this moved nothing. */
const ROW = 48;

describe('the materials page at two widths', () => {
  it('keeps the header and the list where they were when the rows arrive, at 360px', async () => {
    const { before, after } = await shiftAt(360);

    expect(after.header.top).toBe(before.header.top);
    expect(after.listing.top).toBe(before.listing.top);
    expect(after.header.height).toBe(before.header.height);
  });

  it('keeps the header and the list where they were when the rows arrive, at 1280px', async () => {
    const { before, after } = await shiftAt(1280);

    expect(after.header.top).toBe(before.header.top);
    expect(after.listing.top).toBe(before.listing.top);
    expect(after.header.height).toBe(before.header.height);
    expect(Math.abs(after.listing.height - before.listing.height)).toBeLessThan(
      ROW,
    );
  });
});

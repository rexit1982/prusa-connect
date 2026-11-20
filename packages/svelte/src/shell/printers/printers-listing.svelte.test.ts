import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { DECLARED_MODELS } from '../../primitives/printer-icon/declared';
import { expectNoViolations } from '../../test/axe';
import PrintersListing from './printers-listing.svelte';
import type { PrinterFieldId, PrinterRow } from './types';

const row = (id: string, over: Partial<PrinterRow> = {}): PrinterRow => ({
  id,
  name: `MK4S ${id}`,
  model: 'MK4S',
  artwork: 'mk4s',
  state: 'PRINTING',
  tier: 'normal',
  jobName: 'bracket.bgcode',
  progress: 42,
  nozzle: 215,
  nozzleTarget: 230,
  bed: 60,
  bedTarget: 60,
  chamber: undefined,
  chamberTarget: undefined,
  material: 'PETG',
  statusNote: undefined,
  statusAction: undefined,
  severity: undefined,
  retired: undefined,
  removable: true,
  detailHref: `/printers/${id}`,
  ...over,
});

const everything = () => true;

/** Past 72rem, where the table tier applies. */
const WIDE = '1200px';

/** Under it, where the stacked tier applies. */
const NARROW = '600px';

const hosts: HTMLElement[] = [];

/**
 * The listing in a box of a known width. The tier is a container query, so the
 * width of the box around it is what picks one, not the browser window's.
 */
const drawIn = async (
  width: string,
  rows: PrinterRow[],
  shows: (field: PrinterFieldId) => boolean = everything,
): Promise<HTMLElement> => {
  const host = document.createElement('div');
  host.style.inlineSize = width;
  document.body.append(host);
  hosts.push(host);

  await render(PrintersListing, { target: host, props: { rows, shows } });

  return host;
};

const shown = (host: HTMLElement, selector: string): boolean => {
  const found = host.querySelector(selector);
  if (found === null) throw new Error(`no ${selector} rendered`);

  return found.getClientRects().length > 0;
};

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

describe('PrintersListing', () => {
  it('draws both tiers, so the container query picks one without a repaint', async () => {
    const host = await drawIn(WIDE, [row('a'), row('b')]);

    expect(host.querySelectorAll('table')).toHaveLength(1);
    expect(host.querySelectorAll('[data-slot="data-row"]')).toHaveLength(2);
  });

  it('shows the table once the listing clears 72rem', async () => {
    const host = await drawIn(WIDE, [row('a')]);

    expect(shown(host, 'table')).toBe(true);
    expect(shown(host, '[data-slot="data-row"]')).toBe(false);
  });

  it('stacks the same facts under it', async () => {
    const host = await drawIn(NARROW, [row('a')]);

    expect(shown(host, '[data-slot="data-row"]')).toBe(true);
    expect(shown(host, 'table')).toBe(false);
  });

  // Both tiers draw the icon, and the stacked one is what a phone shows. A
  // tier that drew it without the reported spelling read a declared model as
  // unrecognised there.
  it('names a declared model in both tiers', async () => {
    const host = document.createElement('div');
    host.style.inlineSize = WIDE;
    document.body.append(host);
    hosts.push(host);

    await render(PrintersListing, {
      target: host,
      props: {
        rows: [row('a', { model: 'Bench_One', artwork: 'unknown' })],
        shows: everything,
      },
      context: new Map([
        [
          DECLARED_MODELS,
          (reported: string) =>
            reported === 'Bench_One'
              ? { name: 'Bench Works Tool Changer' }
              : undefined,
        ],
      ]),
    });

    const icons = host.querySelectorAll<HTMLImageElement>(
      '[data-slot="printer-icon"]',
    );
    expect(icons).toHaveLength(2);
    for (const icon of icons) expect(icon.alt).toBe('Bench Works Tool Changer');
  });

  it('gives the table a caption naming its order', async () => {
    const host = await drawIn(WIDE, [row('a')]);

    expect(host.querySelector('caption')?.textContent).toBe(
      'Every printer, worst state first',
    );
  });

  it('drops a column the reader put away', async () => {
    const host = await drawIn(
      WIDE,
      [row('a')],
      (field) => field !== 'material',
    );

    const headers = [...host.querySelectorAll('th')].map((head) =>
      head.textContent.trim(),
    );
    expect(headers).not.toContain('Material');
  });

  it('keeps the two columns a reader cannot put away', async () => {
    const host = await drawIn(WIDE, [row('a')], () => false);

    const headers = [...host.querySelectorAll('th')].map((head) =>
      head.textContent.trim(),
    );
    expect(headers).toEqual(['Printer', 'Actions']);
  });

  it('reads a heater against the target it works towards', async () => {
    const host = await drawIn(WIDE, [row('a')]);

    const cells = [...host.querySelectorAll('td')].map((cell) =>
      cell.textContent.replaceAll(/\s+/gu, ''),
    );
    expect(cells).toContain('215°/230°');
  });

  it('has nothing axe refuses', async () => {
    const host = await drawIn(WIDE, [row('a'), row('b')]);

    await expectNoViolations(host);
  });
});

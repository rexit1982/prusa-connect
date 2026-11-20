import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import { expectNoViolations } from '../../test/axe';
import PrinterCard from './printer-card.svelte';
// Not exported from the package: the test reaches for the fixture under
// `src/test`, which `package.json` keeps out of the published files.
import PrinterCardWithEmptyLine from '../../test/printer-card-with-empty-line.svelte';
import PrinterCardWithLine from '../../test/printer-card-with-line.svelte';
import type { PrinterRow } from './types';

const row = (over: Partial<PrinterRow> = {}): PrinterRow => ({
  id: 'p1',
  name: 'MK4S #1234',
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
  detailHref: '/printers/p1',
  ...over,
});

const everything = () => true;

const openActions = async (): Promise<string[]> => {
  await page.getByRole('button', { name: 'Actions for MK4S #1234' }).click();
  await expect
    .poll(() => document.body.querySelectorAll('[role="menuitem"]').length)
    .toBeGreaterThan(0);

  return [...document.body.querySelectorAll('[role="menuitem"]')].map((item) =>
    item.textContent.trim(),
  );
};

describe('PrinterCard', () => {
  it('names the printer and links to it', async () => {
    await render(PrinterCard, { props: { row: row(), shows: everything } });

    await expect
      .element(page.getByRole('link', { name: 'MK4S #1234' }))
      .toHaveAttribute('href', '/printers/p1');
  });

  it('draws the job and how far it has got', async () => {
    await render(PrinterCard, { props: { row: row(), shows: everything } });

    await expect.element(page.getByText('bracket.bgcode')).toBeVisible();
    await expect.element(page.getByText('42%')).toBeVisible();
  });

  // Where the card shows the state, its Idle says there is no job and the
  // line goes; a card without the state says it on the line.
  it('says there is no job rather than leaving the line empty', async () => {
    const idle = row({ jobName: undefined, progress: null, state: 'IDLE' });
    const shown = await render(PrinterCard, {
      props: { row: idle, shows: everything },
    });
    await expect.element(page.getByText('Idle', { exact: true })).toBeVisible();
    await expect.element(page.getByText('No print running')).not.toBeVisible();
    await shown.unmount();

    await render(PrinterCard, {
      props: { row: idle, shows: (field) => field !== 'state' },
    });
    await expect.element(page.getByText('No print running')).toBeVisible();
  });

  it('says a silent printer cannot tell how its print stands', async () => {
    await render(PrinterCard, {
      props: {
        row: row({
          jobName: undefined,
          progress: null,
          nozzle: undefined,
          bed: undefined,
          state: 'OFFLINE',
        }),
        shows: everything,
      },
    });

    await expect
      .element(page.getByText('Print status unavailable'))
      .toBeVisible();
  });

  // A CORE One reports the air inside it. A printer with no chamber gets no
  // box, so its card shows no dash for a reading it never has.
  it('shows the chamber only for a printer that has one', async () => {
    const shown = await render(PrinterCard, {
      props: {
        row: row({ chamber: 38, chamberTarget: 45 }),
        shows: everything,
      },
    });
    await expect.element(page.getByText('Chamber')).toBeInTheDocument();
    expect(shown.container.textContent).toMatch(/38°\s*\/45°/);
    await shown.unmount();

    const { container } = await render(PrinterCard, {
      props: { row: row(), shows: everything },
    });
    expect(container.textContent).not.toContain('Chamber');
  });

  it('drops a field the reader put away', async () => {
    const { container } = await render(PrinterCard, {
      props: { row: row(), shows: (field) => field !== 'job' },
    });

    expect(container.textContent).not.toContain('bracket.bgcode');
  });

  it('tints a card whose printer is broken', async () => {
    const { container } = await render(PrinterCard, {
      props: {
        row: row({ state: 'ERROR', tier: 'critical' }),
        shows: everything,
      },
    });

    const card = container.querySelector('[data-slot="printer-card"]');
    expect(card?.className).toContain('border-destructive');
  });

  it('offers removal of a printer the reader may remove', async () => {
    await render(PrinterCard, { props: { row: row(), shows: everything } });

    expect(await openActions()).toEqual([
      'Pause',
      'Stop print',
      'Remove printer',
    ]);
  });

  it('offers no removal of a printer the reader may not remove', async () => {
    await render(PrinterCard, {
      props: { row: row({ removable: false }), shows: everything },
    });

    expect(await openActions()).toEqual(['Pause', 'Stop print']);
  });

  it('offers neither Pause nor Stop for a printer that is ready', async () => {
    await render(PrinterCard, {
      props: { row: row({ state: 'READY' }), shows: everything },
    });

    expect(await openActions()).toEqual(['Remove printer']);
  });

  it('has nothing axe refuses', async () => {
    const { container } = await render(PrinterCard, {
      props: { row: row(), shows: everything },
    });

    await expectNoViolations(container);
  });

  it('draws the line snippet under the status with the row id', async () => {
    await render(PrinterCardWithLine, {
      props: { row: row(), shows: everything },
    });
    await expect
      .element(page.getByTestId('card-line'))
      .toHaveTextContent(row().id);
  });

  // I3: no module registers a line for most cards, and the wrapper must not
  // reserve space until one does.
  it('adds no space when the line snippet has no registrations', async () => {
    const without = await render(PrinterCard, {
      props: { row: row(), shows: everything },
    });
    const withoutHeight = without.container
      .querySelector('[data-slot="printer-card"]')
      ?.getBoundingClientRect().height;

    const withEmpty = await render(PrinterCardWithEmptyLine, {
      props: { row: row(), shows: everything },
    });
    const withEmptyHeight = withEmpty.container
      .querySelector('[data-slot="printer-card"]')
      ?.getBoundingClientRect().height;

    expect(withEmptyHeight).toBe(withoutHeight);
  });
});

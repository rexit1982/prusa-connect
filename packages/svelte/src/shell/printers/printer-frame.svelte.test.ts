import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import { expectNoViolations } from '../../test/axe';
import PrinterFrame from './printer-frame.svelte';
import type { CameraFeed } from '../printer-cameras';
import type { PrinterRow } from './types';

// A picture that loads, because a still is drawn only once it has.
const GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const FEED: CameraFeed = {
  camera: {
    name: 'bed-cam',
    type: 'push',
    device_id: 'p1',
    formats: ['jpeg', 'mjpeg'],
    serving: true,
    snapshot: true,
    stream: true,
    watch: false,
  },
  pictures: { still: GIF, live: `${GIF}#live` },
};

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

describe('PrinterFrame', () => {
  it('draws the printer itself when there is no camera', async () => {
    const { container } = await render(PrinterFrame, { props: { row: row() } });

    // The reference draws the machine, never an empty grey box.
    expect(container.querySelector('[data-slot="printer-icon"]')).not.toBe(
      null,
    );
  });

  it('writes the percent over the picture', async () => {
    await render(PrinterFrame, { props: { row: row() } });

    await expect.element(page.getByText('42%')).toBeVisible();
  });

  it('writes no overlay for a printer reporting no progress', async () => {
    const { container } = await render(PrinterFrame, {
      props: { row: row({ progress: null, state: 'IDLE' }) },
    });

    expect(container.querySelector('[data-slot="printer-frame-overlay"]')).toBe(
      null,
    );
  });

  it('has nothing axe refuses', async () => {
    const { container } = await render(PrinterFrame, { props: { row: row() } });

    await expectNoViolations(container);
  });
});

describe('PrinterFrame with a camera', () => {
  it('draws the whole still frame, named after the printer', async () => {
    await render(PrinterFrame, { props: { row: row(), camera: FEED } });

    // The alt names the printer, because a wall of frames is a wall of
    // pictures that otherwise read the same to a screen reader.
    const picture = page.getByRole('img', { name: /MK4S #1234/ });
    await expect.element(picture).toHaveAttribute('src', GIF);
    await expect.element(picture).toHaveClass(/object-contain/);
  });

  it('plays the live view from the tile', async () => {
    await render(PrinterFrame, { props: { row: row(), camera: FEED } });

    await page.getByRole('button', { name: 'Play bed-cam live' }).click();

    await expect
      .element(page.getByRole('button', { name: 'Stop bed-cam' }))
      .toBeInTheDocument();
  });

  it('draws the artwork and no camera for a printer with none', async () => {
    await render(PrinterFrame, { props: { row: row() } });

    expect(page.getByRole('button', { name: /bed-cam/ }).elements()).toEqual(
      [],
    );
  });

  it('has no accessibility violation with a frame on it', async () => {
    const { container } = await render(PrinterFrame, {
      props: { row: row(), camera: FEED },
    });

    await expectNoViolations(container);
  });
});

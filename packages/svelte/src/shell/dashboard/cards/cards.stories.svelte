<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';

  import type { Device } from '../../../domain';
  import { dashboardContextOver, fakeCore } from '../fixtures';
  import { fakeDevice } from '../../../test/fakes';
  import TileStory from '../tile-story.svelte';
  import CameraTile from './camera-tile.svelte';
  import ClockTile from './clock-tile.svelte';
  import FinishingTile from './finishing-tile.svelte';
  import IssuesTile from './issues-tile.svelte';
  import NoteTile from './note-tile.svelte';
  import PrinterTile from './printer-tile.svelte';
  import PrintersTile from './printers-tile.svelte';
  import SummaryTile from './summary-tile.svelte';
  import TemperatureTile from './temperature-tile.svelte';
  import UnknownTile from './unknown-tile.svelte';

  const { Story } = defineMeta({
    title: 'Parts/Screen components/Dashboard/Cards',
    component: TileStory,
  });

  const printing = (
    id: string,
    name: string,
    progress: number,
    minutesLeft: number,
  ): Device => ({
    ...fakeDevice(id, name),
    tags: ['workshop'],
    state: {
      '/state': 'PRINTING',
      '/tools/0/nozzle_temp': 215,
      '/temperature/bed': 60,
      '/tools/0/material_package_instance/package/material/abbreviation':
        'PETG',
    },
    job: {
      display_name: `${id}-bracket.bgcode`,
      id: `job-${id}`,
      device_job_id: String(progress),
      path: `usb/${id}-bracket.bgcode`,
      progress,
      running: true,
      state: 'PRINTING',
      time_remaining_ms: minutesLeft * 60_000,
    },
  });

  const waiting = (id: string, name: string, state: string): Device => ({
    ...fakeDevice(id, name),
    model: 'MK4S',
    state: { '/state': state },
  });

  const coreOne = printing('core', 'CORE One bench', 64, 42);

  /** A small workshop: two prints running, one idle, two that need a person. */
  const FLEET: readonly Device[] = [
    // A CORE One reports its chamber, so a card asked for it draws the box.
    {
      ...coreOne,
      state: {
        ...coreOne.state,
        '/temperature/chamber': 38,
        '/temperature/chamber_target': 45,
      },
    },
    printing('xl', 'XL corner', 18, 260),
    waiting('mk4', 'MK4S garage', 'IDLE'),
    waiting('mini', 'MINI desk', 'ATTENTION'),
    waiting('mk3', 'MK3S shelf', 'ERROR'),
  ];

  const contextOf = (devices: readonly Device[]) =>
    dashboardContextOver(fakeCore().client, devices).context;

  const unnamed = (id: string, minutes: number): Device => {
    const device = printing(id, id, 0, minutes);
    const job = device.job;
    if (job === undefined) throw new Error('the printing fixture has no job');
    return { ...device, job: { ...job, display_name: '', path: '' } };
  };
  const estimatesMissing = contextOf([unnamed('no-estimate', 0)]);
  const estimatesMixed = contextOf([
    printing('known', 'Known estimate', 30, 10),
    unnamed('unknown', 0),
  ]);
  const detailsMissing = contextOf([
    waiting('missing', 'Printing without details', 'PRINTING'),
  ]);
  const statusUnknown = contextOf([
    waiting('unknown', 'Unknown status', 'UNKNOWN'),
  ]);

  const fleet = contextOf(FLEET);
  const noPrinters = contextOf([]);
  const allIdle = contextOf(FLEET.filter((device) => device.id === 'mk4'));
</script>

<!--
  Each core tile in its usual state, and in its empty state where it has one.
-->

<Story name="Printer" asChild>
  <TileStory
    context={fleet}
    tile={PrinterTile}
    type="printer"
    config={{ device: 'core' }}
  />
</Story>

<Story name="Printer Not Chosen" asChild>
  <TileStory context={fleet} tile={PrinterTile} type="printer" />
</Story>

<Story name="Printers" asChild>
  <TileStory context={fleet} tile={PrintersTile} type="printers" />
</Story>

<Story name="Printers With Heaters" asChild>
  <TileStory
    context={fleet}
    tile={PrintersTile}
    type="printers"
    config={{
      fields: ['state', 'job', 'progress', 'nozzle', 'bed', 'chamber'],
    }}
  />
</Story>

<Story name="Printers None" asChild>
  <TileStory context={noPrinters} tile={PrintersTile} type="printers" />
</Story>

<Story name="Summary" asChild>
  <TileStory context={fleet} tile={SummaryTile} type="summary" />
</Story>

<Story name="Finishing" asChild>
  <TileStory context={fleet} tile={FinishingTile} type="finishing" />
</Story>

<Story name="Finishing Nothing Printing" asChild>
  <TileStory context={allIdle} tile={FinishingTile} type="finishing" />
</Story>

<Story name="Issues" asChild>
  <TileStory context={fleet} tile={IssuesTile} type="issues" />
</Story>

<Story name="Issues All Clear" asChild>
  <TileStory context={allIdle} tile={IssuesTile} type="issues" />
</Story>

<Story name="Temperature" asChild>
  <TileStory
    context={fleet}
    tile={TemperatureTile}
    type="temperature"
    config={{ device: 'core' }}
  />
</Story>

<Story name="Temperature Not Chosen" asChild>
  <TileStory context={fleet} tile={TemperatureTile} type="temperature" />
</Story>

<Story name="Camera Not Chosen" asChild>
  <TileStory context={fleet} tile={CameraTile} type="camera" />
</Story>

<Story name="Note" asChild>
  <TileStory
    context={fleet}
    tile={NoteTile}
    type="note"
    title="Shift"
    config={{
      text: 'Ask before you take a plate.\nCall 512 when the XL jams.',
    }}
  />
</Story>

<Story name="Note Tinted" asChild>
  <TileStory
    context={fleet}
    tile={NoteTile}
    type="note"
    config={{
      text: 'Out of PETG',
      size: 'xl',
      tone: 'attention',
      align: 'center',
    }}
  />
</Story>

<Story name="Note Empty" asChild>
  <TileStory context={fleet} tile={NoteTile} type="note" />
</Story>

<Story name="Clock" asChild>
  <TileStory
    context={fleet}
    tile={ClockTile}
    type="clock"
    config={{ seconds: true, date: true }}
  />
</Story>

<Story name="Unknown Card" asChild>
  <div class="flex h-80 w-96 flex-col rounded-sm border border-border p-3">
    <UnknownTile type="spools/left" />
  </div>
</Story>

<Story name="Finishing Estimates Unavailable" asChild>
  <TileStory context={estimatesMissing} tile={FinishingTile} type="finishing" />
</Story>
<Story name="Finishing Some Estimates Missing" asChild>
  <TileStory context={estimatesMixed} tile={FinishingTile} type="finishing" />
</Story>
<Story name="Finishing Print Details Missing" asChild>
  <TileStory context={detailsMissing} tile={FinishingTile} type="finishing" />
</Story>
<Story name="Finishing Status Unavailable" asChild>
  <TileStory context={statusUnknown} tile={FinishingTile} type="finishing" />
</Story>

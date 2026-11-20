<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';

  import type { Device } from '../../domain';
  import {
    fakeDevice,
    fakeListing,
    fakeListingStore,
    searchFilter,
    sortOf,
    stateFilter,
  } from '../../test/fakes';
  import PrintersScreen from './printers-screen.svelte';

  const { Story } = defineMeta({
    title: 'Parts/Screen components/Printers',
    component: PrintersScreen,
  });

  const MODELS = ['MK4S', 'CORE One', 'XL'];
  const STATES = ['PRINTING', 'IDLE', 'ATTENTION', 'ERROR', 'FINISHED'];

  const devicesOf = (count: number) =>
    Array.from({ length: count }, (_, index) => {
      const model = MODELS[index % MODELS.length] ?? 'MK4S';

      return {
        ...fakeDevice(`p${String(index)}`, `${model} #${String(1000 + index)}`),
        model,
        state: {
          '/state': STATES[index % STATES.length],
          // A CORE One reports its chamber, so its card shows the fourth box.
          ...(model === 'CORE One'
            ? {
                '/temperature/chamber': 38,
                '/temperature/chamber_target': 45,
              }
            : {}),
        },
        // An administrator, so each card offers Remove printer.
        actions: ['observe', 'operate', 'configure', 'administer'],
      };
    });

  /** What the server advertises for a fleet of these models and states. */
  const ADVERTISED = {
    filters: [
      searchFilter(),
      stateFilter(STATES),
      {
        param: 'model' as const,
        kind: 'multi' as const,
        values: MODELS.map((value) => ({ value, count: 4 })),
      },
    ],
    sorts: [
      sortOf('urgency'),
      sortOf('name'),
      sortOf('model'),
      sortOf('state'),
      sortOf('last_seen'),
      sortOf('id'),
    ],
  };

  const listingOf = (count: number, total = count) =>
    fakeListing({ ...ADVERTISED, items: devicesOf(count), total });

  const incomplete: readonly Device[] = [
    ...['PRINTING', 'PAUSED', 'ATTENTION', 'BUSY', 'IDLE', 'UNKNOWN'].map(
      (state) => ({
        ...fakeDevice(state, `${state} — no job details`),
        state: {
          '/state': state,
          '/tools/0/nozzle_temp': 180,
          '/temperature/bed': 60,
        },
      }),
    ),
    {
      ...fakeDevice('unnamed', 'PRINTING — unnamed active print'),
      state: { '/state': 'PRINTING' },
      job: {
        id: '',
        device_job_id: '7',
        display_name: '',
        path: '',
        progress: 0,
        running: true,
        state: 'PRINTING',
        time_remaining_ms: 0,
      },
    },
  ];

  const store = fakeListingStore();

  const onAdd = () => undefined;
</script>

<!--
  The React specification's own story titles, so the two sets line up: a fleet,
  a single printer, a pair, the empty instance and the load.
-->

<Story name="Fleet" asChild>
  <PrintersScreen listing={listingOf(12)} printerCount={12} {store} {onAdd} />
</Story>

<Story name="More Than One Page" asChild>
  <PrintersScreen
    listing={listingOf(50, 120)}
    printerCount={120}
    {store}
    {onAdd}
  />
</Story>

<Story name="Something Is Wrong" asChild>
  <PrintersScreen
    listing={fakeListing({
      ...ADVERTISED,
      items: devicesOf(12),
      issues: {
        affected: 5,
        counts: {},
        by_severity: { error: 2, warning: 3, info: 1 },
      },
    })}
    printerCount={12}
    {store}
    {onAdd}
  />
</Story>

<Story name="Single Printer Drops The Fleet Machinery" asChild>
  <PrintersScreen
    listing={listingOf(1)}
    printerCount={1}
    preference="auto"
    {store}
    {onAdd}
  />
</Story>

<Story name="A Pair Keeps The Roomy Layout" asChild>
  <PrintersScreen
    listing={listingOf(2)}
    printerCount={2}
    preference="auto"
    {store}
    {onAdd}
  />
</Story>

<Story name="One Printer Without The Preference" asChild>
  <PrintersScreen listing={listingOf(1)} printerCount={1} {store} {onAdd} />
</Story>

<Story name="Nothing Registered Yet" asChild>
  <PrintersScreen listing={fakeListing()} printerCount={0} {store} {onAdd} />
</Story>

<Story name="Still Arriving" asChild>
  <PrintersScreen
    listing={fakeListing({ loading: true, loaded: false })}
    printerCount={0}
    {store}
    {onAdd}
  />
</Story>

<Story name="Incomplete Print Data" asChild>
  <PrintersScreen
    listing={fakeListing({
      ...ADVERTISED,
      items: incomplete,
      total: incomplete.length,
    })}
    printerCount={incomplete.length}
    {store}
    {onAdd}
  />
</Story>

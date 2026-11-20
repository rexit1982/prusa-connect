<!--
  One printer, as a tile draws it: the drawing or a still frame, its name and
  state, the print with its bar and the time left, the heaters and the
  material.

  It reads like the core's own printer card, from the same primitives, so a
  printer on a dashboard is the printer a person knows from the Printers
  screen. Each fact is drawn only when the tile's settings ask for it, and a
  fact the printer never reported reads as a dash and never as a zero.

  The whole face links to the printer's own page. The layout follows the size
  of the box it sits in (frontend-css.md, container queries): the drawing
  shows once there is room beside the name, and the heaters fold under each
  other in a narrow tile. In a tile of many printers the heaters and the
  material go last, under the print.
-->
<script lang="ts">
  import { formatDate, formatDuration, formatUnit } from '../../../i18n';
  import {
    PRINTER_STATE_LABEL_KEY,
    type PrinterSeverityTier,
  } from '../../../domain';
  import {
    Badge,
    ChamberIcon,
    HeatbedIcon,
    NozzleIcon,
    PrinterIcon,
    SpoolIcon,
    TemperatureReading,
  } from '../../../primitives';

  import type { PrinterView } from '../printers';
  import {
    formatRemainingCompact,
    jobFallbackOf,
    SEVERITY_LABEL_KEY,
    severityBadgeVariant,
    stateBadgeVariant,
  } from '../../printers/presentation';
  import { t } from '../../../i18n';
  import { dashboardContext } from '../context';
  import type { Picture, PrinterField } from './config';
  import JobBar from './job-bar.svelte';

  let {
    view,
    fields,
    picture = 'art',
    frame,
    dense = false,
  }: {
    view: PrinterView;
    fields: readonly PrinterField[];
    picture?: Picture;
    /** The newest still frame of the printer's camera, when it has one. */
    frame?: string | undefined;
    /** Drawn inside a tile of many printers, where every line counts. */
    dense?: boolean;
  } = $props();

  const { clock } = dashboardContext();

  // One heater box and its reading, as the core's printer card draws them.
  const BOX =
    'flex min-w-0 items-center justify-center rounded-sm border border-border px-1.5 py-1';
  const VALUE = 'flex min-w-0 items-center truncate tabular-nums';

  // The words of an issue take the tint of how loud it is. Only the two
  // loudest tiers have one, which is the rule the core's printer cards follow.
  const ISSUE_TONE: Readonly<Record<PrinterSeverityTier, string>> = {
    critical: 'text-destructive-text',
    attention: 'text-warning-text',
    'not-reporting': 'text-muted-foreground',
    normal: 'text-muted-foreground',
  };

  const shows = (field: PrinterField): boolean => fields.includes(field);

  const offline = $derived(view.state === 'OFFLINE');
  const stateLabel = $derived(t(PRINTER_STATE_LABEL_KEY[view.state]));
  const remainingText = $derived(
    view.remaining === undefined ? '' : formatDuration(view.remaining),
  );
  const remainingCompact = $derived(
    view.remaining === undefined ? '' : formatRemainingCompact(view.remaining),
  );
  // When the print ends, as a time of day. The clock moves it, so a wall
  // that stays open for hours keeps a true answer.
  const endsAt = $derived(
    view.remaining === undefined
      ? ''
      : formatDate(clock.minute + view.remaining * 1000, {
          timeStyle: 'short',
        }),
  );
  // Only a printer with a chamber gets its box, so an MK4 shows no dash.
  const showsChamber = $derived(shows('chamber') && view.chamber !== undefined);
  const showsHeat = $derived(
    shows('nozzle') || shows('bed') || showsChamber || shows('material'),
  );

  // The clock moves the time of day the print ends. One timer serves every
  // face on the page.
  $effect(() => clock.hold());
</script>

{#snippet nozzleIcon()}
  <NozzleIcon aria-hidden="true" class="me-1" />
{/snippet}

{#snippet bedIcon()}
  <HeatbedIcon aria-hidden="true" class="me-1" />
{/snippet}

{#snippet chamberIcon()}
  <ChamberIcon aria-hidden="true" class="me-1" />
{/snippet}

<a
  href={view.detailHref}
  data-part="printer-face"
  data-state={view.state}
  class={[
    '@container/face flex h-full min-h-0 min-w-0 flex-col gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
    offline && 'text-muted-foreground',
  ]}
>
  {#if picture === 'camera' && frame !== undefined && !dense}
    <img
      src={frame}
      alt={t('dashboard.printer.frame', { name: view.name })}
      class="aspect-video w-full shrink-0 rounded-sm bg-muted object-cover"
      loading="lazy"
    />
  {/if}

  <div class="flex min-w-0 items-start gap-3">
    {#if picture !== 'none' && (picture === 'art' || frame === undefined)}
      <PrinterIcon
        model={view.artwork}
        reported={view.model}
        class={[
          'hidden shrink-0 @3xs/face:block',
          dense ? 'size-10' : 'size-14',
        ]}
      />
    {/if}
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div
        data-dense={dense || undefined}
        class="model-state flex items-center justify-between gap-2"
      >
        <p class="min-w-0 truncate text-xs text-muted-foreground">
          {view.model === view.name ? '' : view.model}
        </p>
        {#if shows('state')}
          <Badge
            size="md"
            variant={stateBadgeVariant(view.state)}
            class="shrink-0"
          >
            {stateLabel}
          </Badge>
        {/if}
      </div>
      <p
        data-dense={dense || undefined}
        class={[
          'face-name truncate',
          dense
            ? 'text-sm font-semibold'
            : 'text-base font-bold @xs/face:text-lg',
        ]}
        title={view.name}
      >
        {view.name}
      </p>
    </div>
  </div>

  {#if shows('job') || shows('progress')}
    <div
      class={[
        'flex flex-col gap-1',
        dense && 'order-2',
        dense &&
          (shows('remaining') && view.remaining !== undefined
            ? 'mbs-0'
            : 'mbs-auto'),
      ]}
    >
      <div
        class="flex items-baseline justify-between gap-3 font-mono text-xs text-muted-foreground"
      >
        {#if shows('job')}
          <span class="min-w-0 truncate" title={view.jobName}>
            {view.jobName ?? jobFallbackOf(view)}
          </span>
        {:else}
          <span></span>
        {/if}
        {#if shows('progress') && view.progress !== null}
          <span class="shrink-0 text-foreground tabular-nums">
            {formatUnit(view.progress, '%')}
          </span>
        {/if}
      </div>
      {#if shows('progress')}
        <JobBar {view} />
      {/if}
    </div>
  {/if}

  {#if shows('remaining') && view.remaining !== undefined}
    <p
      data-part="printer-remaining"
      class={[
        'flex items-baseline tabular-nums',
        dense
          ? 'order-1 mbs-auto flex-nowrap justify-between gap-2 text-xs'
          : 'flex-wrap gap-x-2 text-sm',
      ]}
    >
      <span
        class={['font-semibold', dense && 'block min-w-0 truncate']}
        title={t('dashboard.printer.left', { time: remainingText })}
      >
        {#if dense}<span class="inline">{remainingCompact}</span>{/if}
        <span class={[dense && 'hidden']}
          >{t('dashboard.printer.left', { time: remainingText })}</span
        >
      </span>
      <span
        class={[
          'text-xs text-muted-foreground',
          dense && 'block min-w-0 truncate',
        ]}
        title={t('dashboard.printer.endsAt', { time: endsAt })}
      >
        {#if dense}<span class="inline"
            >{t('dashboard.printer.endsAtCompact', { time: endsAt })}</span
          >{/if}
        <span class={[dense && 'hidden']}
          >{t('dashboard.printer.endsAt', { time: endsAt })}</span
        >
      </span>
    </p>
  {/if}

  {#if showsHeat}
    <!-- In a tile of many the boxes go last, under the print. -->
    <dl
      class={[
        'grid gap-2 font-mono text-xs',
        // A tile of many is narrow, and a box per line would make each
        // printer tall, so its boxes go two by two from the start. Four in a
        // row are too narrow for a reading and its target until the face is
        // wide.
        dense ? 'grid-cols-2' : 'grid-cols-1',
        showsChamber
          ? '@3xs/face:grid-cols-2 @md/face:grid-cols-4'
          : '@3xs/face:grid-cols-3',
        dense ? 'order-3' : 'mbs-auto',
      ]}
    >
      {#if shows('nozzle')}
        <div class={BOX}>
          <dt class="sr-only">{t('dashboard.printer.nozzle')}</dt>
          <dd class={VALUE}>
            <TemperatureReading
              icon={nozzleIcon}
              current={view.nozzle}
              target={view.nozzleTarget}
              muted={offline}
            />
          </dd>
        </div>
      {/if}
      {#if shows('bed')}
        <div class={BOX}>
          <dt class="sr-only">{t('dashboard.printer.bed')}</dt>
          <dd class={VALUE}>
            <TemperatureReading
              icon={bedIcon}
              current={view.bed}
              target={view.bedTarget}
              muted={offline}
            />
          </dd>
        </div>
      {/if}
      {#if showsChamber}
        <div class={BOX}>
          <dt class="sr-only">{t('dashboard.printer.chamber')}</dt>
          <dd class={VALUE}>
            <TemperatureReading
              icon={chamberIcon}
              current={view.chamber}
              target={view.chamberTarget}
              muted={offline}
              chamber
            />
          </dd>
        </div>
      {/if}
      {#if shows('material')}
        <div class={BOX}>
          <dt class="sr-only">{t('dashboard.printer.material')}</dt>
          <dd class={VALUE}>
            <SpoolIcon aria-hidden="true" class="me-1" />
            {#if view.material === undefined}&mdash;{:else}{view.material}{/if}
          </dd>
        </div>
      {/if}
    </dl>
  {/if}

  {#if shows('issue') && view.statusNote !== undefined}
    <p
      data-part="printer-issue"
      class={['flex items-start gap-2 text-sm', ISSUE_TONE[view.tier]]}
    >
      {#if view.severity !== undefined}
        <Badge variant={severityBadgeVariant(view.severity)} class="shrink-0">
          {t(SEVERITY_LABEL_KEY[view.severity])}
        </Badge>
      {/if}
      <span class="line-clamp-2 min-w-0">{view.statusNote}</span>
    </p>
  {/if}
</a>

<style>
  @container face (width < 10rem) {
    .model-state[data-dense] {
      flex-direction: column;
      align-items: start;
      gap: var(--spacing);
    }

    .face-name[data-dense] {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      white-space: normal;
      overflow-wrap: anywhere;
    }
  }
</style>

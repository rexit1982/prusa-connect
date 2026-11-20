<!-- One printer, at the size a reader looks at when there are few of them. -->
<script module lang="ts">
  const sentences =
    typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter('en', { granularity: 'sentence' })
      : undefined;
</script>

<script lang="ts">
  import { filamentPreview } from './filament-colors';
  import { displayedFilamentOf } from './filament-preferences';
  import {
    capabilityFor,
    PRINTER_STATE_LABEL_KEY,
    PRINTER_STATE_PROGRESS_TONE,
    projectLifecycleVerb,
  } from '../../domain';
  import { formatDuration, t } from '../../i18n';
  import {
    ABOVE_ROW_LINK,
    Badge,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    ClippedName,
    ChamberIcon,
    ConfirmDialog,
    DropdownMenuItem,
    HeatbedIcon,
    NozzleIcon,
    PrinterIcon,
    Progress,
    RowActions,
    Separator,
    SpoolIcon,
    TemperatureReading,
  } from '../../primitives';
  import {
    retiredReasonOf,
    SEVERITY_LABEL_KEY,
    severityBadgeVariant,
    stateBadgeVariant,
    cardToneOf,
    formatRemainingCompact,
    jobFallbackOf,
    printActivityOf,
  } from './presentation';
  import type { PrinterCardProps } from './types';

  let {
    row,
    shows,
    actions,
    picture: Picture,
    line,
    onMenuOpenChange,
  }: PrinterCardProps = $props();

  const PAUSE_PRINT = capabilityFor('pause_print');
  const STOP_PRINT = capabilityFor('stop_print');

  // The row carries no capability list, so each verb is offered as if the
  // printer had it and the state alone decides.
  const available = (verb: 'pause_print' | 'stop_print') =>
    projectLifecycleVerb(verb, {
      capabilities: [capabilityFor(verb)],
      state: row.state,
    }).kind === 'available';
  const canPause = $derived(available('pause_print'));
  const canStop = $derived(available('stop_print'));

  // One telemetry box and its reading.
  const BOX =
    'flex min-w-0 items-center justify-center rounded-sm border border-border px-1.5 py-1';
  const VALUE = 'flex min-w-0 items-center truncate tabular-nums';

  // Only a printer with a chamber gets its box, so an MK4 shows no dash.
  const showChamber = $derived(shows('chamber') && row.chamber !== undefined);

  const titleId = $props.id();

  const preview = filamentPreview();
  const filament = $derived(displayedFilamentOf(row, preview));

  const issueSummary = $derived(
    row.statusNote !== undefined
      ? (sentences
          ?.segment(row.statusNote.trim())
          .containing(0)
          ?.segment.trim() ?? row.statusNote)
      : row.statusNote,
  );

  const progress = $derived(row.progress);
  const hasPrintProgress = $derived(
    progress !== null || printActivityOf(row) === 'active',
  );
  const showProgressBar = $derived(hasPrintProgress && shows('progress'));

  const stateLabel = $derived(t(PRINTER_STATE_LABEL_KEY[row.state]));

  const noJobLine = $derived(jobFallbackOf(row));

  // The bar names the print it measures.
  const progressLabel = $derived(
    t('printers.progressLabel', { name: row.jobName ?? row.name }),
  );

  // A host that supplies no action leaves the item inert.
  const send = (verb: string): void => {
    void actions?.command?.(row.id, verb);
  };

  // The menu shuts as the item is picked, so the card holds the question.
  let removing = $state(false);
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

<Card
  data-slot="printer-card"
  role="region"
  aria-labelledby={titleId}
  tone={cardToneOf(row.tier)}
  density="snug"
  class="@container/printer-card relative isolate overflow-hidden"
>
  <CardHeader class="grid-cols-1">
    <div class="flex gap-3">
      {#if Picture}
        <Picture />
      {:else}
        <PrinterIcon
          model={row.artwork}
          reported={row.model}
          class="hidden size-14 shrink-0 @[22rem]/printer-card:block"
        />
      {/if}

      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <div class="flex items-baseline justify-between gap-2">
          <p class="min-w-0 truncate text-xs text-muted-foreground">
            {row.model === row.name ? '' : row.model}
          </p>
          <span class="flex shrink-0 items-center gap-1 self-center">
            {#if row.retired}
              <Badge
                mono
                size="md"
                variant="secondary"
                class="min-w-28 shrink-0"
              >
                {t('printers.retired')}
              </Badge>
            {:else if shows('state')}
              <Badge
                size="md"
                variant={stateBadgeVariant(row.state)}
                class="min-w-28 shrink-0"
              >
                {stateLabel}
              </Badge>
            {/if}
            <!-- A sibling of the stretched link and lifted above it. A
                 retired printer takes no command. -->
            {#if !row.retired && (canPause || canStop || row.removable)}
              <span class={[ABOVE_ROW_LINK, '-my-2.5']}>
                <RowActions name={row.name} onOpenChange={onMenuOpenChange}>
                  {#if canPause}
                    <DropdownMenuItem
                      onSelect={() => {
                        send(PAUSE_PRINT);
                      }}
                    >
                      {t('printers.action.pause')}
                    </DropdownMenuItem>
                  {/if}
                  {#if canStop}
                    <DropdownMenuItem
                      onSelect={() => {
                        send(STOP_PRINT);
                      }}
                    >
                      {t('printers.action.stop')}
                    </DropdownMenuItem>
                  {/if}
                  {#if row.removable}
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        removing = true;
                      }}
                    >
                      {t('printers.action.remove')}
                    </DropdownMenuItem>
                  {/if}
                </RowActions>
              </span>
            {/if}
          </span>
        </div>

        <CardTitle id={titleId} class="text-sm font-bold">
          <h2
            class={[
              'contents',
              row.tier === 'not-reporting' && 'text-muted-foreground',
            ]}
          >
            <a
              href={row.detailHref}
              title={row.name}
              class="block truncate after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
            >
              {row.name}
            </a>
          </h2>
        </CardTitle>
      </div>
    </div>
  </CardHeader>

  <div
    class={[
      row.state === 'IDLE' &&
      !row.retired &&
      shows('state') &&
      row.jobName === undefined &&
      !showProgressBar
        ? 'hidden'
        : 'flex',
      'flex-col',
      showProgressBar ? 'gap-2' : 'gap-1',
      (showProgressBar || (shows('job') && row.jobName !== undefined)) &&
        !row.retired &&
        'mt-3',
    ]}
  >
    <div
      class="flex h-4 items-baseline justify-between gap-3 px-4 font-mono text-xs leading-4 text-muted-foreground @[24rem]/card:px-6"
    >
      {#if shows('job')}
        {#if row.jobName === undefined}
          {#if noJobLine !== undefined}<span class="min-w-0 truncate"
              >{noJobLine}</span
            >{/if}
        {:else}
          <div class="flex min-w-0 items-baseline gap-2">
            <ClippedName name={row.jobName} class="min-w-0" />
            {#if row.remaining !== undefined && !row.retired}
              <span
                class="shrink-0 whitespace-nowrap"
                title={t('dashboard.printer.left', {
                  time: formatDuration(row.remaining),
                })}
              >
                {formatRemainingCompact(row.remaining)}
              </span>
            {/if}
          </div>
        {/if}
      {:else}
        <span></span>
      {/if}
      {#if progress !== null && shows('progress')}
        <span class="ms-auto shrink-0 tabular-nums">{progress}%</span>
      {/if}
    </div>

    <div
      class={[
        'items-center px-4 @[24rem]/card:px-6',
        showProgressBar ? 'h-1' : 'h-0.5',
        !showProgressBar &&
        row.jobName === undefined &&
        (noJobLine === t('printers.printStatusUnavailable') ||
          noJobLine === t('printers.noJob'))
          ? 'hidden'
          : 'flex',
      ]}
    >
      {#if showProgressBar}
        <Progress
          value={progress}
          aria-label={progressLabel}
          tone={PRINTER_STATE_PROGRESS_TONE[row.state]}
          size="sm"
          class={[
            row.state === 'PRINTING' &&
              '[&>[data-slot=progress-indicator]]:bg-primary',
          ]}
        />
      {:else}
        <Separator />
      {/if}
    </div>
  </div>

  <CardContent class="flex flex-1 flex-col gap-4">
    {#if shows('nozzle') || shows('bed') || showChamber || shows('material')}
      <!-- Four boxes in a row are too narrow for a reading and its target
           until the card is wide, so they wrap two by two before that. -->
      <dl
        class={[
          'order-last mbs-auto grid gap-2 font-mono text-xs',
          showChamber
            ? 'grid-cols-2 @[28rem]/printer-card:grid-cols-4'
            : 'grid-cols-3',
        ]}
      >
        {#if shows('nozzle')}
          <div class={BOX}>
            <dt class="sr-only">{t('printers.nozzle')}</dt>
            <dd class={VALUE}>
              <TemperatureReading
                icon={nozzleIcon}
                current={row.nozzle}
                target={row.nozzleTarget}
              />
            </dd>
          </div>
        {/if}
        {#if shows('bed')}
          <div class={BOX}>
            <dt class="sr-only">{t('printers.bed')}</dt>
            <dd class={VALUE}>
              <TemperatureReading
                icon={bedIcon}
                current={row.bed}
                target={row.bedTarget}
              />
            </dd>
          </div>
        {/if}
        {#if showChamber}
          <div class={BOX}>
            <dt class="sr-only">{t('printers.chamber')}</dt>
            <dd class={VALUE}>
              <TemperatureReading
                icon={chamberIcon}
                current={row.chamber}
                target={row.chamberTarget}
                chamber
              />
            </dd>
          </div>
        {/if}
        {#if shows('material')}
          <div class={BOX}>
            <dt class="sr-only">{t('printers.material')}</dt>
            <dd class={VALUE}>
              <SpoolIcon
                aria-hidden="true"
                class="me-1"
                filamentColor={filament.color?.[1]}
              />
              {#if filament.color}<span class="sr-only"
                  >{t(filament.color[2])}</span
                >{/if}
              {#if filament.material === undefined}&mdash;{:else}{filament.material}{/if}
            </dd>
          </div>
        {/if}
      </dl>
    {/if}

    {#if row.retired}
      <p class="text-sm text-muted-foreground">
        {retiredReasonOf(row.retired.reason)}
      </p>
    {:else if shows('issue') && row.statusNote !== undefined}
      <div class="flex flex-col gap-1">
        <p
          class={[
            'flex items-start gap-2',
            row.tier === 'critical' && 'text-base text-destructive-text',
            row.tier === 'attention' && 'text-base text-warning-text',
            row.tier !== 'critical' &&
              row.tier !== 'attention' &&
              'text-sm text-muted-foreground',
          ]}
        >
          {#if row.severity !== undefined}
            <Badge variant={severityBadgeVariant(row.severity)}>
              {t(SEVERITY_LABEL_KEY[row.severity])}
            </Badge>
          {/if}
          <span class="line-clamp-2 min-w-0">{issueSummary}</span>
          <a
            class={[
              ABOVE_ROW_LINK,
              'shrink-0 text-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            ]}
            href={row.detailHref}
            aria-label={t('printers.issues.moreFor', { name: row.name })}
            >{t('printers.issues.more')}</a
          >
        </p>
      </div>
    {/if}

    {#if line}
      <!-- empty:hidden: no module registers a line for most cards, and a
           card with none must match a card with no `line` prop at all
           (I3, "no layout shift"). -->
      <div class="flex flex-col gap-1 empty:hidden">{@render line(row.id)}</div>
    {/if}
  </CardContent>
</Card>

<ConfirmDialog
  open={removing}
  onOpenChange={(open: boolean) => {
    removing = open;
  }}
  title={t('printers.remove.title', { name: row.name })}
  description={t('printers.remove.note', { name: row.name })}
  confirmLabel={t('printers.remove.confirm')}
  onConfirm={() => {
    void actions?.retire?.(row.id);
  }}
/>

<style>
  /* The card's fill reads --card, so the raised step is set here, on the
     card's own root, and covers nothing outside it. */
  :global([data-slot='printer-card']) {
    --card: var(--card-raised);
  }
</style>

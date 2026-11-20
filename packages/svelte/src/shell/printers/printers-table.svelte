<!--
  Every printer as a row, for a container wide enough to hold eight columns.
  The narrow tier beside it draws the same facts stacked.
-->
<script lang="ts">
  import { FileCodeCornerIcon } from '@lucide/svelte';

  import SortableTableHead from '../../primitives/table/sortable-table-head.svelte';
  import { filamentPreview } from './filament-colors';
  import { displayedFilamentOf } from './filament-preferences';
  import {
    PRINTER_STATE_LABEL_KEY,
    PRINTER_STATE_PROGRESS_TONE,
  } from '../../domain';
  import { t } from '../../i18n';
  import {
    Badge,
    SpoolIcon,
    ClippedName,
    FileThumbnail,
    ChamberIcon,
    HeatbedIcon,
    NozzleIcon,
    PrinterIcon,
    Progress,
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TemperatureReading,
  } from '../../primitives';
  import { stateBadgeVariant } from './presentation';
  import type { PrinterFieldId, PrinterRow } from './types';

  const DIRECTION = { asc: 'ascending', desc: 'descending' } as const;

  let {
    rows,
    shows,
    sortField,
    sortOrder,
    onSort,
  }: {
    rows: readonly PrinterRow[];
    sortField?: string | undefined;
    sortOrder?: 'asc' | 'desc' | undefined;
    onSort?:
      | Partial<
          Record<
            'name' | 'state',
            ((order: 'asc' | 'desc') => void) | undefined
          >
        >
      | undefined;
    shows: (field: PrinterFieldId) => boolean;
  } = $props();
  const preview = filamentPreview();
</script>

{#snippet printerSortHead(field: 'name' | 'state', label: string)}
  {@const sort = onSort?.[field]}
  {#if sort}
    <SortableTableHead
      {label}
      direction={sortField !== field || sortOrder === undefined
        ? undefined
        : DIRECTION[sortOrder]}
      onSort={(order: 'asc' | 'desc' | undefined) => {
        if (order !== undefined) sort(order);
      }}
    />
  {:else}
    <TableHead>{label}</TableHead>
  {/if}
{/snippet}

{#snippet nozzleIcon()}
  <NozzleIcon aria-hidden="true" class="size-3.5" />
{/snippet}

{#snippet bedIcon()}
  <HeatbedIcon aria-hidden="true" class="size-3.5" />
{/snippet}

{#snippet chamberIcon()}
  <ChamberIcon aria-hidden="true" class="size-3.5" />
{/snippet}

<Table>
  <TableCaption class="sr-only">{t('printers.caption')}</TableCaption>
  <TableHeader>
    <TableRow>
      {@render printerSortHead('name', t('printers.printer'))}
      {#if shows('state')}
        {@render printerSortHead('state', t('printers.state'))}
      {/if}
      {#if shows('job')}<TableHead>{t('printers.job')}</TableHead>{/if}
      {#if shows('progress')}<TableHead>{t('printers.progress')}</TableHead
        >{/if}
      {#if shows('nozzle')}<TableHead>{t('printers.nozzle')}</TableHead>{/if}
      {#if shows('bed')}<TableHead>{t('printers.bed')}</TableHead>{/if}
      {#if shows('chamber')}<TableHead>{t('printers.chamber')}</TableHead>{/if}
      {#if shows('material')}<TableHead>{t('printers.material')}</TableHead
        >{/if}
      <TableHead class="sr-only">{t('printers.actions')}</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {#each rows as row (row.id)}
      <TableRow
        class={row.tier === 'critical' ? 'bg-destructive/5' : undefined}
      >
        <TableCell class="max-w-64">
          <div class="flex items-center gap-3">
            <PrinterIcon
              model={row.artwork}
              reported={row.model}
              class="size-11 shrink-0"
            />
            <div class="min-w-0">
              <a
                href={row.detailHref}
                class="block truncate rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                >{row.name}</a
              >
              {#if row.model !== row.name}
                <p class="truncate text-xs text-muted-foreground">
                  {row.model}
                </p>
              {/if}
            </div>
          </div>
        </TableCell>
        {#if shows('state')}
          <TableCell>
            {#if row.retired}
              <Badge mono variant="secondary">
                {t('printers.retired')}
              </Badge>
            {:else}
              <Badge variant={stateBadgeVariant(row.state)}>
                {t(PRINTER_STATE_LABEL_KEY[row.state])}
              </Badge>
            {/if}
          </TableCell>
        {/if}
        {#if shows('job')}
          <TableCell roomy class="max-w-64">
            <div class="flex items-center gap-3">
              {#if row.jobName === undefined}
                <span class="size-printer-print-preview shrink-0"></span>
                <span class="text-muted-foreground">{t('printers.noJob')}</span>
              {:else}
                <FileThumbnail
                  name={row.jobName}
                  glyph={FileCodeCornerIcon}
                  thumbnailUrl={row.jobThumbnailUrl}
                  size="print"
                />
                <ClippedName name={row.jobName} class="min-w-0" />
              {/if}
            </div>
          </TableCell>
        {/if}
        {#if shows('progress')}
          <TableCell>
            {#if row.progress !== null}
              <div class="flex max-w-28 min-w-16 flex-col gap-1">
                <span class="tabular-nums">{row.progress}%</span>
                <Progress
                  value={row.progress}
                  aria-label={t('printers.progressLabel', {
                    name: row.jobName ?? row.name,
                  })}
                  tone={PRINTER_STATE_PROGRESS_TONE[row.state]}
                  size="sm"
                />
              </div>
            {/if}
          </TableCell>
        {/if}
        {#if shows('nozzle')}
          <TableCell>
            <TemperatureReading
              icon={nozzleIcon}
              current={row.nozzle}
              target={row.nozzleTarget}
            />
          </TableCell>
        {/if}
        {#if shows('bed')}
          <TableCell>
            <TemperatureReading
              icon={bedIcon}
              current={row.bed}
              target={row.bedTarget}
            />
          </TableCell>
        {/if}
        {#if shows('chamber')}
          <TableCell>
            <TemperatureReading
              icon={chamberIcon}
              current={row.chamber}
              target={row.chamberTarget}
              chamber
            />
          </TableCell>
        {/if}
        {#if shows('material')}
          {@const filament = displayedFilamentOf(row, preview)}
          <TableCell>
            {#if (filament.material ?? '') !== '' || filament.color}
              <span class="inline-flex items-center gap-1">
                <SpoolIcon
                  aria-hidden="true"
                  filamentColor={filament.color?.[1]}
                />
                {#if filament.color}<span class="sr-only"
                    >{t(filament.color[2])}</span
                  >{/if}
                {filament.material ?? ''}
              </span>
            {:else}
              {row.material ?? ''}
            {/if}
          </TableCell>
        {/if}
        <TableCell></TableCell>
      </TableRow>
    {/each}
  </TableBody>
</Table>

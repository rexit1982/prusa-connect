<!--
  What the person narrows the list to, drawn by the library's listing toolbar:
  the search, then the printing technology, the type, the manufacturer, the
  location and the colour as facets, four switches that each keep fewer
  materials, and the order on the right.

  Each control writes to the list, which sends it as the query of
  `GET /materials`. The module does the filtering, and the switches combine.
  A resin has no type in the catalogue, so the type filter goes away while
  Resin is picked.
-->
<script lang="ts">
  import {
    ListingSearch,
    ListingToolbar,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    type FacetDimension,
    type ListingToolbarProps,
  } from '@prusa/connect-ui/primitives';

  import { onMount } from 'svelte';

  import type { ListQuery } from '../api';
  import { heldHost } from '../host';
  import { heldList } from '../list.svelte';
  import { PALETTE } from '../colour-palette';
  import ColourSwatches from '../colour-swatches.svelte';

  const list = heldList();
  const t = heldHost().t;

  const SWITCHES = [
    { key: 'favourites', label: 'materials.filter.favourites', star: true },
    { key: 'in_stock', label: 'materials.filter.inStock', star: false },
    { key: 'custom', label: 'materials.filter.custom', star: false },
    { key: 'assigned', label: 'materials.filter.assigned', star: false },
  ] as const;

  const CLASS_LABELS: Record<string, string> = {
    FFF: 'materials.filter.fff',
    SLA: 'materials.filter.sla',
  };

  // The sort options. Relevance is the module's own order: favourites,
  // then what can be loaded, then custom, then the rest. It counts only
  // filament no printer holds, while In stock and Most in stock count every
  // live spool. Every other one names a key and a direction.
  const ORDERS = [
    { key: 'default', label: 'materials.sort.relevance' },
    { key: 'name-asc', label: 'materials.sort.nameAsc' },
    { key: 'name-desc', label: 'materials.sort.nameDesc' },
    { key: 'brand-asc', label: 'materials.sort.brandAsc' },
    { key: 'type-asc', label: 'materials.sort.typeAsc' },
    { key: 'weight-desc', label: 'materials.sort.weightDesc' },
    { key: 'weight-asc', label: 'materials.sort.weightAsc' },
    { key: 'spools-desc', label: 'materials.sort.spoolsDesc' },
  ] as const;

  const colour = $derived(
    PALETTE.find((swatch) => swatch.key === list.query.color),
  );

  onMount(() => {
    void list.readFacets();
  });

  const held = (value: string | undefined): string[] =>
    value === undefined ? [] : [value];

  // A resin has no type to keep, so picking Resin lets the type go.
  const chooseClass = (chosen: ListQuery['class']): void => {
    void list.narrow({
      class: chosen,
      type: chosen === 'SLA' ? undefined : list.query.type,
    });
  };

  const facets = $derived<FacetDimension[]>([
    {
      id: 'class',
      label: t('materials.filter.class'),
      values: Object.keys(CLASS_LABELS),
      selected: held(list.query.class),
      onSelectedChange: (next: string[]) => {
        chooseClass(next[0]);
      },
      labelFor: (value: string) => t(CLASS_LABELS[value] ?? value),
      mode: 'single',
      allLabel: t('materials.filter.all'),
      searchable: false,
    },
    ...(list.query.class === 'SLA'
      ? []
      : [
          {
            id: 'type',
            label: t('materials.filter.type'),
            values: [...list.types],
            selected: held(list.query.type),
            onSelectedChange: (next: string[]) =>
              void list.narrow({ type: next[0] }),
            mode: 'single' as const,
            allLabel: t('materials.filter.anyType'),
            searchable: true,
          },
        ]),
    {
      id: 'brand',
      label: t('materials.filter.brand'),
      values: list.brands.map((brand) => brand.slug),
      selected: held(list.query.brand),
      onSelectedChange: (next: string[]) =>
        void list.narrow({ brand: next[0] }),
      labelFor: (slug: string) =>
        list.brands.find((brand) => brand.slug === slug)?.name ?? slug,
      mode: 'single',
      allLabel: t('materials.filter.anyBrand'),
      searchable: true,
    },
    ...(list.locations.length === 0
      ? []
      : [
          {
            id: 'location',
            label: t('materials.filter.location'),
            values: list.locations.map((l) => String(l.id)),
            selected: held(list.query.location?.toString()),
            onSelectedChange: (next: string[]) =>
              void list.narrow({
                location: next[0] === undefined ? undefined : Number(next[0]),
              }),
            labelFor: (id: string) =>
              list.locations.find((l) => String(l.id) === id)?.name ?? id,
            mode: 'single' as const,
            allLabel: t('materials.filter.anyLocation'),
            searchable: true,
          },
        ]),
    {
      id: 'colour',
      label: t('materials.add.colour'),
      values: [],
      selected: held(list.query.color),
      onSelectedChange: (next: string[]) =>
        void list.narrow({ color: next[0] }),
      labelFor: (key: string) => t(`materials.colour.${key}`),
      swatches: colour ? [colour.hex] : [],
      panel: colourPanel,
    },
  ]);

  const toggles = $derived<NonNullable<ListingToolbarProps['toggles']>>(
    SWITCHES.map((which) => ({
      id: which.key,
      label: t(which.label),
      pressed: list.query[which.key] === true,
      onPressedChange: (on: boolean) =>
        void list.narrow({ [which.key]: on || undefined }),
      ...(which.star ? { icon: star } : {}),
    })),
  );

  const sort = (key: string): void => {
    const [order, direction] = key.split('-');
    void list.narrow({
      order:
        key === 'default'
          ? undefined
          : (order as NonNullable<ListQuery['order']>),
      desc: direction === 'desc' || undefined,
    });
  };

  const sorted = $derived(
    list.query.order === undefined
      ? 'default'
      : `${list.query.order}-${list.query.desc === true ? 'desc' : 'asc'}`,
  );
</script>

{#snippet star()}
  <span aria-hidden="true">★</span>
{/snippet}

{#snippet colourPanel()}
  <div class="p-3">
    <ColourSwatches
      value={list.query.color}
      onPick={(color: string | undefined) => void list.narrow({ color })}
    />
  </div>
{/snippet}

{#snippet search()}
  <!-- The read waits for the person to leave the field or press Enter: one
       request per letter would be a request per keystroke. -->
  <ListingSearch
    commit="change"
    label={t('materials.filter.search')}
    placeholder={t('materials.filter.searchPlaceholder')}
    value={list.query.q ?? ''}
    onValue={(q: string) => void list.narrow({ q: q.trim() || undefined })}
  />
{/snippet}

{#snippet order()}
  <Select
    value={sorted}
    items={ORDERS.map((o) => ({ value: o.key, label: t(o.label) }))}
    onValueChange={sort}
  >
    <SelectTrigger
      size="sm"
      class="min-w-40"
      aria-label={t('materials.sort.label')}
    >
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {#each ORDERS as o (o.key)}
        <SelectItem value={o.key}>{t(o.label)}</SelectItem>
      {/each}
    </SelectContent>
  </Select>
{/snippet}

<div data-part="filters">
  <ListingToolbar
    {facets}
    {toggles}
    filtersActive={list.narrowed}
    onClearFilters={() => void list.clearFilters()}
    {search}
    beforeControls={order}
  />
</div>

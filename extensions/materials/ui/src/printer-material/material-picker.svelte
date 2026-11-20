<!--
  Chooses what a printer tool holds, in one flow: a search field, and under it
  the results as you type. The first row hands the tool back to what the
  printer reports. Favourites come next, then the rest of the catalogue, from
  one request in the order the module keeps: favourites, then what can be
  loaded, most filament first, then custom materials, then the rest. Colour, type
  and manufacturer filters sit in two compact rows under the search. Until the
  person types or filters, the catalogue shows a short preview. A picked
  material with spools opens them, and Confirm puts the picked spool on the
  tool.

  The picker assigns by itself: the host draws it where it likes (a popover, a
  dialog), shuts it on `onclose` and reads the tools again on `onassigned`.
  `ontitle` and `onbusy` are for a host with a header that follows the picker
  while one of its forms is open or a write is in flight.
-->
<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Plus from '@lucide/svelte/icons/plus';
  import Star from '@lucide/svelte/icons/star';
  import X from '@lucide/svelte/icons/x';
  import { formatNumber } from '@prusa/connect-ui/i18n';
  import {
    Alert,
    Button,
    Label,
    ListingSearch,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SpoolIcon,
    toast,
  } from '@prusa/connect-ui/primitives';
  import { FilamentColorWheel } from '@prusa/connect-ui/shell';
  import { moduleTabId } from '@prusa/connect-ui/slots';
  import { onMount, tick, untrack } from 'svelte';

  import { SpoolDraftForm } from '../add-dialog/draft.svelte';
  import SpoolDetails from '../add-dialog/spool-details.svelte';
  import CustomMaterialForm from '../add-dialog/custom-material-form.svelte';
  import type {
    Detail,
    MaterialFields,
    MaterialsService,
    Row,
    Spool,
    Tool,
  } from '../api';
  import { heldCatalogue } from '../catalogue.svelte';
  import { WHEEL, WHEEL_OUTER } from '../colour-palette';
  import { heldHost } from '../host';
  import { heldList, MaterialList } from '../list.svelte';
  import MaterialDetails from '../material-page/material-details.svelte';
  import FaultNote from '../materials-page/fault-note.svelte';
  import { kilograms } from '../materials-page/weights';
  import { OWN_MODULE } from '../own-module';
  import SearchSelect from '../search-select.svelte';
  import { refusalText } from './reasons';

  let {
    service,
    deviceId,
    tool,
    onclose,
    onassigned,
    ontitle,
    onbusy,
  }: {
    service: MaterialsService;
    deviceId: string;
    tool: Tool;
    /** Cancel, and what the host shuts itself on after an assignment. */
    onclose: () => void;
    /** The tool took the choice; the host reads its tools again. */
    onassigned: () => void;
    /** The title of the form the picker swapped itself for, undefined when it is back. */
    ontitle?: (title?: string) => void;
    /** A write is in flight, so the host should not be shut under it. */
    onbusy?: (busy: boolean) => void;
  } = $props();

  /** Catalogue rows shown before the person types, filters or asks for more. */
  const PREVIEW = 5;

  const host = heldHost();
  const t = host.t;
  const uid = $props.id();
  const inventory = heldList();
  const catalogue = heldCatalogue();
  const list = new MaterialList(
    untrack(() => service),
    Promise.resolve(inventory.mayWrite),
  );

  const reported = untrack(() => tool.reported);
  const hasMaterial = untrack(() => Boolean(tool.assignment?.material_uuid));

  // The host writes /m/<namespace>/<path>, which is how a module learns the
  // namespace its catalogue settings tab is under.
  const namespace = host.pageHref('').split('/')[2] ?? '';
  const settingsHref = `/settings/extensions/${namespace}/${moduleTabId(namespace, 'catalogue')}`;

  let query = $state('');
  let type = $state<string>();
  let brand = $state<string>();
  let colour = $state<string>();
  let expanded = $state(false);
  /** The tool goes back to what the printer reports. Chosen when it holds nothing. */
  let reading = $state(!hasMaterial);
  let picked = $state.raw<Row>();
  let spoolId = $state('');
  let spools = $state.raw<readonly Spool[]>();
  let fault = $state.raw<unknown>();
  let assigning = $state(false);
  let creating = $state(false);
  let saving = $state(false);
  let formFault = $state.raw<unknown>();
  let spoolOptions = $state(false);
  let spoolDraft = $state.raw<SpoolDraftForm>();
  let formArea = $state<HTMLDivElement>();
  let pickerArea = $state<HTMLDivElement>();
  let detailsOpen = $state(false);
  let details = $state.raw<Detail>();
  let detailsFault = $state.raw<unknown>();

  const filtered = $derived({
    q: query.trim() || undefined,
    type,
    brand,
    color: colour,
  });
  const filterCount = $derived(
    [type, brand, colour].filter((value) => value !== undefined).length,
  );
  const favourites = $derived(list.rows.filter((row) => row.is_favourite));
  const others = $derived(list.rows.filter((row) => !row.is_favourite));
  const previewOnly = $derived(
    !expanded && query.trim() === '' && filterCount === 0,
  );
  const visibleOthers = $derived(
    previewOnly ? others.slice(0, PREVIEW) : others,
  );
  const canShowMore = $derived(
    (previewOnly && others.length > PREVIEW) || list.next !== undefined,
  );
  const refusal = $derived(
    refusalText(
      t,
      fault,
      reading ? 'unassign' : 'assign',
      tool.reported?.abbreviation ?? '',
    ),
  );
  const noCatalogue = $derived(catalogue.status?.loaded === false);
  const shown = $derived(
    t('materials.add.count', {
      shown: favourites.length + visibleOthers.length,
      total: list.total,
    }),
  );

  function spoolLabel(spool: Spool): string {
    const id = t('materials.printer.spool', { id: spool.id });
    const weight = t('materials.printer.grams', {
      g: formatNumber(spool.remaining_weight_g, { maximumFractionDigits: 0 }),
    });
    const use = available(spool) ? undefined : t('materials.header.inUse');
    return [id, weight, spool.location, use].filter(Boolean).join(' · ');
  }

  // The spools no printer holds and the filament on them, the key the
  // module orders by, so the rows read in the order they stand.
  const meta = (row: Row): string => {
    const free = row.spools - row.assigned_spools;
    return [
      row.brand_name,
      row.type,
      free > 0 ? t('materials.picker.spools', { n: free }) : '',
      row.free_g > 0
        ? t('materials.picker.weight', { kg: kilograms(row.free_g) })
        : '',
    ]
      .filter((part) => part !== '')
      .join(' · ');
  };

  onMount(() => {
    pickerArea
      ?.querySelector<HTMLInputElement>('input[type="search"]')
      ?.focus();
    void list.readFacets();
    const current = tool.assignment?.material_uuid;
    if (!current) return;
    const { signal } = spoolRead;
    void service.material(current, signal).then(
      (detail) => {
        if (!signal.aborted) void select(detail);
      },
      () => undefined,
    );
  });

  let revision = $state(0);
  $effect(() => {
    const filters = filtered;
    const requested = revision;
    const timer = setTimeout(() => {
      if (revision !== requested) return;
      void list.narrow({ ...filters, class: 'FFF', limit: 25 });
    }, 180);
    return () => clearTimeout(timer);
  });

  const available = (spool: Spool): boolean =>
    spool.tool == null ||
    (spool.tool.device_id === deviceId && spool.tool.tool_id === tool.id);

  let spoolRead = new AbortController();
  const lifetime = new AbortController();
  let disposed = false;
  onMount(() => () => {
    disposed = true;
    lifetime.abort();
    spoolRead.abort();
  });

  const select = async (
    row: Row | undefined,
    preferredSpoolId = tool.assignment?.spool_id,
  ): Promise<void> => {
    spoolRead.abort();
    spoolRead = new AbortController();
    const { signal } = spoolRead;
    picked = row;
    reading = row === undefined;
    detailsOpen = false;
    details = undefined;
    detailsFault = undefined;
    spoolId = '';
    fault = undefined;
    spools = row?.spools === 0 ? [] : undefined;
    if (!row || row.spools === 0) return;
    try {
      const found: Spool[] = [];
      let offset: number | undefined;
      do {
        const page = await service.spools(row.uuid, offset, signal);
        found.push(...page.spools.filter((spool) => spool.archived_at == null));
        offset = page.next;
      } while (offset !== undefined && !signal.aborted);
      if (signal.aborted) return;
      spools = found;
      const current = found.find((spool) => spool.id === preferredSpoolId);
      if (current) spoolId = String(current.id);
    } catch (thrown) {
      if (!signal.aborted) fault = thrown;
    }
  };

  $effect(() => {
    const uuid = picked?.uuid;
    if (!detailsOpen || !uuid || details?.uuid === uuid) return;
    const request = new AbortController();
    detailsFault = undefined;
    void service.material(uuid, request.signal).then(
      (result) => {
        if (!request.signal.aborted) details = result;
      },
      (error: unknown) => {
        if (!request.signal.aborted) detailsFault = error;
      },
    );
    return () => request.abort();
  });

  const openCreate = async (): Promise<void> => {
    if (assigning) return;
    formFault = undefined;
    creating = true;
    ontitle?.(t('materials.custom.title'));
    await tick();
    formArea?.focus();
  };

  const closeForm = async (action: 'create' | 'add-spool'): Promise<void> => {
    creating = false;
    spoolDraft = undefined;
    spoolOptions = false;
    ontitle?.();
    await tick();
    document.getElementById(`${uid}-${action}`)?.focus();
  };

  const openSpoolForm = async (row: Row): Promise<void> => {
    if (assigning) return;
    const draft = new SpoolDraftForm();
    spoolDraft = draft;
    formFault = undefined;
    ontitle?.(t('materials.spools.add'));
    await tick();
    formArea?.focus();
    try {
      const material =
        details?.uuid === row.uuid
          ? details
          : await service.material(row.uuid, lifetime.signal);
      if (spoolDraft === draft) draft.choose(material);
    } catch (error) {
      if (spoolDraft === draft && !disposed) formFault = error;
    }
  };

  const showInvalidSpoolOption = async (event: Event): Promise<void> => {
    if (spoolOptions || !(event.target instanceof HTMLInputElement)) return;
    const field = event.target;
    if (!field.closest('[data-part="spool-details"]')) return;

    event.preventDefault();
    spoolOptions = true;
    await tick();
    field.focus();
    field.reportValidity();
  };

  const addSpool = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const draft = spoolDraft;
    const row = picked;
    if (!draft?.valid || !row || saving || !inventory.mayWrite) return;
    saving = true;
    onbusy?.(true);
    formFault = undefined;
    try {
      const { added, ids } = await service.addSpools(draft.body());
      toast.success(t('materials.add.created', { n: added }));
      if (disposed) return;
      revision += 1;
      void inventory.read();
      void select({ ...row, spools: row.spools + added }, ids[0]);
      void closeForm('add-spool');
    } catch (error) {
      formFault = error;
    } finally {
      saving = false;
      if (!disposed) onbusy?.(false);
    }
  };

  const create = async (fields: MaterialFields): Promise<void> => {
    if (saving || !inventory.mayWrite) return;
    saving = true;
    formFault = undefined;
    try {
      const uuid = await service.createCustom(fields);
      toast.success(t('materials.custom.created'), {
        description: fields.name,
      });
      if (disposed) return;
      revision += 1;
      void select({
        uuid,
        name: fields.name,
        brand_name: fields.brand_name ?? '',
        class: fields.class,
        type: fields.type ?? '',
        color_rgba: fields.color_rgba ?? '',
        is_custom: true,
        is_favourite: false,
        spools: 0,
        assigned_spools: 0,
        remaining_g: 0,
        free_g: 0,
      });
      void closeForm('create');
    } catch (error) {
      formFault = error;
    } finally {
      saving = false;
    }
  };

  const ready = $derived(
    reading
      ? hasMaterial
      : picked !== undefined &&
          spools !== undefined &&
          (spools.length === 0 || spoolId !== ''),
  );

  const confirm = async (): Promise<void> => {
    if (!ready || assigning || !inventory.mayWrite) return;
    assigning = true;
    fault = undefined;
    try {
      if (picked === undefined) {
        await service.unassign(deviceId, tool.id);
      } else {
        await service.assign(
          deviceId,
          tool.id,
          spoolId === '' || spoolId === 'material'
            ? { material_uuid: picked.uuid }
            : { spool_id: Number(spoolId) },
        );
      }
      onassigned();
    } catch (thrown) {
      fault = thrown;
    } finally {
      assigning = false;
    }
  };

  const setFavourite = async (row: Row, on: boolean): Promise<void> => {
    if (!inventory.mayWrite || !(await list.star(row.uuid, on))) return;
    if (picked?.uuid === row.uuid) picked = { ...picked, is_favourite: on };
  };

  const showMore = (): void => {
    if (previewOnly) {
      expanded = true;
      if (others.length > PREVIEW) return;
    }
    void list.more();
  };

  const clearFilters = (): void => {
    type = undefined;
    brand = undefined;
    colour = undefined;
  };
</script>

{#snippet materialDetailsToggle()}
  <Button
    type="button"
    size="sm"
    variant="ghost"
    class="shrink-0"
    aria-expanded={detailsOpen}
    aria-controls={`${uid}-material-details`}
    onclick={() => (detailsOpen = !detailsOpen)}
  >
    {t('materials.tools.details')}
    {#if detailsOpen}
      <X aria-hidden="true" class="size-4" />
    {:else}
      <ChevronRight aria-hidden="true" class="detail-direction size-4" />
    {/if}
  </Button>
{/snippet}

{#snippet pickerSelect(
  id: string,
  value: string,
  placeholder: string,
  items: { value: string; label: string; disabled?: boolean }[],
  selectValue: (value: string) => void,
)}
  <Select {value} {items} onValueChange={selectValue}>
    <SelectTrigger {id} class="w-full min-w-0">
      <SelectValue {placeholder} />
    </SelectTrigger>
    <SelectContent>
      {#each items as item (item.value)}
        <SelectItem
          value={item.value}
          label={item.label}
          disabled={item.disabled ?? false}
        >
          {item.label}
        </SelectItem>
      {/each}
    </SelectContent>
  </Select>
{/snippet}

{#snippet choice(
  on: boolean,
  color: string | undefined,
  name: string,
  note: string,
  choose: () => void,
  star?: Row,
)}
  <div class="choice grid items-center gap-1">
    <Button
      variant="ghost"
      aria-pressed={on}
      title={note ? `${name} · ${note}` : name}
      class="h-8 min-w-0 justify-start gap-2 px-2 py-0 text-start font-normal whitespace-nowrap aria-pressed:bg-secondary aria-pressed:ring-1 aria-pressed:ring-ring"
      onclick={choose}
    >
      <SpoolIcon
        aria-hidden="true"
        filamentColor={color === '' ? undefined : color}
      />
      <span class="min-w-0 truncate font-medium">{name}</span>
      {#if note}
        <span class="min-w-0 shrink-2 truncate text-xs text-muted-foreground">
          {note}
        </span>
      {/if}
    </Button>
    {#if star && inventory.mayWrite}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-pressed={star.is_favourite}
        label={t('materials.picker.favourite', { name })}
        disabled={list.busy}
        onclick={() => void setFavourite(star, !star.is_favourite)}
      >
        <Star
          aria-hidden="true"
          class={star.is_favourite ? 'fill-current' : undefined}
        />
      </Button>
    {/if}
  </div>
{/snippet}

<div data-module={OWN_MODULE} class="flex min-h-0 flex-col">
  {#if creating}
    <div
      bind:this={formArea}
      tabindex="-1"
      role="region"
      aria-label={t('materials.custom.title')}
      data-material-picker
      class="min-h-0 overflow-y-auto p-3 outline-none"
    >
      <CustomMaterialForm
        filamentOnly
        compact
        submitLabel={t('materials.custom.create')}
        busy={saving}
        fault={formFault}
        onsave={(fields: MaterialFields) => void create(fields)}
        oncancel={() => {
          if (!saving) void closeForm('create');
        }}
      />
    </div>
  {:else if spoolDraft}
    <div
      bind:this={formArea}
      tabindex="-1"
      role="region"
      aria-label={t('materials.spools.add')}
      class="min-h-0 overflow-y-auto outline-none"
      data-picker-expanded={spoolOptions || undefined}
    >
      <form
        class={['spool-form', { expanded: spoolOptions }]}
        onsubmit={(event) => void addSpool(event)}
        oninvalidcapture={(event) => void showInvalidSpoolOption(event)}
      >
        <div class="grid min-w-0 content-start gap-3 p-3">
          <p class="text-sm font-medium">{picked?.name}</p>
          <SpoolDetails draft={spoolDraft} section="remaining" />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            class="justify-self-start"
            aria-expanded={spoolOptions}
            aria-controls={`${uid}-spool-options`}
            onclick={() => (spoolOptions = !spoolOptions)}
          >
            <ChevronDown
              class={['size-4', { 'rotate-180': spoolOptions }]}
              aria-hidden="true"
            />
            {t('materials.add.stepSpools')}
          </Button>
          {#if !spoolDraft.material && !formFault}
            <p role="status" class="text-sm text-muted-foreground">
              {t('materials.add.reading')}
            </p>
          {/if}
          <FaultNote fault={formFault} />
        </div>
        <div
          id={`${uid}-spool-options`}
          class="spool-options min-w-0 p-3"
          hidden={!spoolOptions}
        >
          {#if spoolDraft.material}
            <SpoolDetails draft={spoolDraft} section="optional" />
          {/if}
        </div>
        <div
          class="spool-actions flex justify-end gap-2 border-t border-border p-3"
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onclick={() => void closeForm('add-spool')}
          >
            {t('materials.add.cancel')}
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!spoolDraft.valid || saving}
          >
            {t('materials.spools.add')}
          </Button>
        </div>
      </form>
    </div>
  {:else}
    <div
      class="material-picker min-h-0"
      data-material-picker
      data-picker-expanded={detailsOpen || undefined}
    >
      <div
        bind:this={pickerArea}
        class="material-picker-main flex min-h-0 min-w-0 flex-col"
      >
        <div class="grid shrink-0 gap-2 border-b border-border p-3">
          <ListingSearch
            class="min-w-0"
            label={t('materials.filter.search')}
            placeholder={t('materials.filter.searchPlaceholder')}
            value={query}
            onValue={(text: string) => (query = text)}
          />
          <div
            class="picker-filters grid items-center gap-3"
            data-part="picker-filters"
          >
            <FilamentColorWheel
              colors={WHEEL}
              outerCount={WHEEL_OUTER}
              selected={WHEEL.find(([family]) => family === colour)}
              labelOf={(family: (typeof WHEEL)[number]) => t(family[2])}
              onChoose={([family]: (typeof WHEEL)[number]) =>
                (colour = colour === family ? undefined : family)}
            />
            <div
              class="grid min-w-0 gap-2 **:data-[slot=facet-popover-trigger]:w-full **:data-[slot=facet-popover-trigger]:max-w-none **:data-[slot=facet-popover-trigger]:min-w-0"
            >
              <SearchSelect
                label={t('materials.add.type')}
                allLabel={t('materials.add.anyType')}
                options={list.types.map((option) => ({
                  value: option,
                  label: option,
                }))}
                value={type}
                onPick={(value: string | undefined) => (type = value)}
              />
              <SearchSelect
                label={t('materials.filter.brand')}
                allLabel={t('materials.filter.anyBrand')}
                options={list.brands.map((option) => ({
                  value: option.slug,
                  label: option.name,
                }))}
                value={brand}
                onPick={(value: string | undefined) => (brand = value)}
              />
              {#if filterCount > 0}
                <Button
                  size="sm"
                  variant="ghost"
                  class="justify-self-start"
                  onclick={clearFilters}
                >
                  <X aria-hidden="true" />
                  {t('materials.add.clear')}
                </Button>
              {/if}
            </div>
          </div>
        </div>

        <div
          class="max-h-picker-list min-h-0 overflow-y-auto"
          data-part="header-material-assignment"
          aria-busy={list.busy}
        >
          <div class="grid gap-0.5 px-3 py-2 text-sm">
            {#if refusal}
              <Alert variant="destructive"
                ><span class="col-start-2">{refusal}</span></Alert
              >
            {:else}
              <FaultNote fault={fault ?? list.fault} />
            {/if}

            {@render choice(
              reading,
              reported?.color_rgba,
              t('printerDetailInfo.filament.useReported'),
              reported?.abbreviation ?? t('materials.picker.nothingReported'),
              () => void select(undefined),
            )}

            {#if favourites.length > 0}
              <h3
                class="mt-1 border-t border-border px-2 pt-2 pb-0.5 text-xs font-semibold text-muted-foreground"
              >
                {t('materials.picker.favourites')}
              </h3>
              {#each favourites as item (item.uuid)}
                {@render choice(
                  picked?.uuid === item.uuid,
                  item.color_rgba,
                  item.name,
                  meta(item),
                  () => void select(item),
                  item,
                )}
              {/each}
            {/if}
            {#if visibleOthers.length > 0}
              <h3
                class="mt-1 border-t border-border px-2 pt-2 pb-0.5 text-xs font-semibold text-muted-foreground"
              >
                {t('materials.picker.catalogue')}
              </h3>
              {#each visibleOthers as item (item.uuid)}
                {@render choice(
                  picked?.uuid === item.uuid,
                  item.color_rgba,
                  item.name,
                  meta(item),
                  () => void select(item),
                  item,
                )}
              {/each}
            {/if}
            {#if list.rows.length === 0 && list.loaded && !list.busy && !list.fault}
              <p class="px-2 py-1 text-muted-foreground">
                {t('materials.header.noMatches')}
                {#if noCatalogue}
                  {t('materials.add.noCatalogue')}
                  <a href={settingsHref} class="underline underline-offset-4">
                    {t('materials.add.settings')}
                  </a>
                {/if}
              </p>
            {:else if !list.loaded && !list.fault}
              <p class="px-2 py-1 text-muted-foreground">
                {t('materials.add.reading')}
              </p>
            {/if}
            {#if canShowMore}
              <Button
                size="sm"
                variant="ghost"
                disabled={list.busy}
                onclick={showMore}
              >
                {t('materials.header.more')}
              </Button>
            {/if}
            {#if list.loaded}
              <p role="status" class="sr-only">{shown}</p>
            {/if}
          </div>
        </div>

        {#if picked}
          <div
            class="grid shrink-0 gap-2 border-t border-border px-3 py-2 text-sm"
            data-part="picked-material"
          >
            <div class="flex items-center justify-between gap-2">
              <p class="min-w-0 font-medium break-words">{picked.name}</p>
              {@render materialDetailsToggle()}
            </div>
            <div class="picked-spool grid items-center gap-2">
              {#if spools === undefined && fault === undefined}
                <p class="text-muted-foreground">
                  {t('materials.printer.readingSpools')}
                </p>
              {:else if spools && spools.length > 0}
                <Label class="sr-only" for={`${uid}-spool`}
                  >{t('materials.tools.spool')}</Label
                >
                {@render pickerSelect(
                  `${uid}-spool`,
                  spoolId,
                  t('materials.header.chooseSpool'),
                  [
                    {
                      value: 'material',
                      label: t('materials.printer.materialOnly'),
                    },
                    ...spools.map((spool) => ({
                      value: String(spool.id),
                      label: spoolLabel(spool),
                      disabled: !available(spool),
                    })),
                  ],
                  (value) => (spoolId = value),
                )}
              {:else}
                <span></span>
              {/if}
              {#if inventory.mayWrite}
                <Button
                  id={`${uid}-add-spool`}
                  disabled={assigning}
                  class="shrink-0"
                  size="sm"
                  variant="ghost"
                  onclick={() => {
                    if (picked) void openSpoolForm(picked);
                  }}
                >
                  <Plus aria-hidden="true" />
                  {t('materials.spools.add')}
                </Button>
              {/if}
            </div>
          </div>
        {/if}
        <div
          class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2"
        >
          {#if inventory.mayWrite}
            <Button
              size="sm"
              variant="ghost"
              id={`${uid}-create`}
              disabled={assigning}
              onclick={() => void openCreate()}
            >
              <Plus aria-hidden="true" />
              {t('materials.add.create')}
            </Button>
          {/if}
          <div class="ms-auto flex gap-2">
            <Button size="sm" variant="ghost" onclick={onclose}
              >{t('primitives.cancel')}</Button
            >
            <Button
              size="sm"
              disabled={!ready || assigning}
              onclick={() => void confirm()}
            >
              {t('printerDetailInfo.filament.confirm')}
            </Button>
          </div>
        </div>
      </div>
      <section
        id={`${uid}-material-details`}
        class="material-picker-details min-w-0 p-4"
        aria-label={t('materials.tools.details')}
        hidden={!detailsOpen}
      >
        {#if detailsOpen && picked}
          <h4 class="mb-4 text-sm font-semibold break-words">{picked.name}</h4>
          {#if details}
            <MaterialDetails detail={details} bare wrapValues />
          {:else if detailsFault}
            <FaultNote fault={detailsFault} />
          {:else}
            <p role="status" class="text-sm text-muted-foreground">
              {t('materials.header.readingDetails')}
            </p>
          {/if}
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  @media (width < 44rem) {
    :global(.detail-direction) {
      rotate: 90deg;
    }
  }

  .choice {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .picker-filters {
    grid-template-columns: 6.5rem minmax(0, 1fr);
  }

  .picked-spool {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .material-picker {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .material-picker-details {
    border-block-start: 1px solid var(--color-border);
  }

  @media (width < 44rem) {
    .material-picker[data-picker-expanded] {
      overflow-y: auto;
    }

    .material-picker[data-picker-expanded] .material-picker-main {
      min-block-size: max-content;
    }
  }

  .spool-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .spool-options {
    border-block-start: 1px solid var(--color-border);
  }

  @media (min-width: 44rem) {
    .material-picker[data-picker-expanded] {
      grid-template-columns: min(420px, calc(100vw - 17rem)) minmax(0, 1fr);
    }

    .spool-form.expanded {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }

    .material-picker-details,
    .spool-options {
      border-block-start: 0;
      border-inline-start: 1px solid var(--color-border);
    }
  }

  .spool-actions {
    grid-column: 1 / -1;
  }
</style>

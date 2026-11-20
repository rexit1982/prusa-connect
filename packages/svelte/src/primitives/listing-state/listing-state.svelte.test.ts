import { describe, expect, it } from 'vitest';

import type { ListField } from '../field-picker';
import { DEFAULT_PAGE_SIZE } from '../pager/sizes';
import { viewModes } from '../view-mode';
import { viewPreferences } from '../view-preferences';
import {
  type FacetDimension,
  ListingState,
  type ListingStore,
} from './listing-state.svelte';

const FIELDS: ListField[] = [
  { id: 'name', label: 'Name', required: true },
  { id: 'state', label: 'State' },
  { id: 'note', label: 'Note', hiddenByDefault: true },
];

const VIEWS = viewModes(['cards', 'table']);

/** A store a test reads back, standing in for localStorage. */
const fakeStore = (
  seed: Record<string, string> = {},
): ListingStore & { held: Map<string, string> } => {
  const held = new Map(Object.entries(seed));

  return {
    held,
    read: (key) => held.get(key) ?? null,
    write: (key, value) => {
      held.set(key, value);
    },
  };
};

/** A store that refuses both ways, the way a private window does. */
const refusingStore = (): ListingStore => ({
  read: () => {
    throw new Error('refused');
  },
  write: () => {
    throw new Error('refused');
  },
});

const listing = (
  rows: readonly string[],
  overrides: Partial<{
    store: ListingStore;
    id: string;
    viewSetting: string;
    initialView: string;
  }> = {},
) =>
  new ListingState({
    id: overrides.id ?? 'printers',
    viewSetting: overrides.viewSetting,
    fields: FIELDS,
    views: VIEWS,
    initialView: overrides.initialView ?? 'cards',
    store: overrides.store ?? fakeStore(),
    rows: () => rows,
  });

const rowsOf = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `row-${String(index)}`);

describe('ListingState', () => {
  it('hands the pager the page it is on and the pages there are', () => {
    const state = listing(rowsOf(61));

    expect(state.pager?.page).toBe(0);
    expect(state.pager?.pageCount).toBe(3);
    expect(state.page).toHaveLength(25);
    expect(state.total).toBe(61);
  });

  it('moves a page and gives back what is left on the last one', () => {
    const state = listing(rowsOf(61));

    state.pager?.onPageChange(2);

    expect(state.page).toHaveLength(11);
  });

  it('returns to the first page when the size changes', () => {
    const state = listing(rowsOf(61));

    state.pager?.onPageChange(2);
    state.pager?.onPageSizeChange(50);

    expect(state.pager?.page).toBe(0);
    expect(state.page).toHaveLength(50);
  });

  it('starts every field visible but the ones hidden by default', () => {
    const state = listing(rowsOf(1));

    expect(state.fields.visible).toEqual(['name', 'state']);
  });

  it('toggles a field and puts the defaults back', () => {
    const state = listing(rowsOf(1));

    state.fields.onToggle('state');
    expect(state.fields.visible).toEqual(['name']);

    state.fields.onToggle('note');
    expect(state.fields.visible).toEqual(['name', 'note']);

    state.fields.onReset();
    expect(state.fields.visible).toEqual(['name', 'state']);
  });

  it('refuses to hide a required field', () => {
    const state = listing(rowsOf(1));

    state.fields.onToggle('name');

    expect(state.fields.visible).toContain('name');
  });

  it('writes the fields, the view and the size under its own key', () => {
    const store = fakeStore();
    const state = listing(rowsOf(61), { store });

    state.fields.onToggle('state');
    state.view.onValueChange('table');
    state.pager?.onPageSizeChange(50);

    const held = store.held.get('listing.printers');
    expect(held).toBeDefined();
    expect(JSON.parse(held ?? '{}')).toEqual({
      fields: ['name'],
      known: ['name', 'state', 'note'],
      view: 'table',
      pageSize: 50,
    });
  });

  // A column a release adds is one the reader never hid, so it appears for a
  // reader who saved a choice before it existed. One hidden by default stays
  // hidden, and a field the reader hid stays hidden.
  it('shows a field added after the reader saved a choice', () => {
    const store = fakeStore();
    listing(rowsOf(3), { store }).fields.onToggle('state');

    const later = new ListingState({
      id: 'printers',
      fields: [
        ...FIELDS,
        { id: 'chamber', label: 'Chamber' },
        { id: 'serial', label: 'Serial', hiddenByDefault: true },
      ],
      views: VIEWS,
      initialView: 'cards',
      store,
      rows: () => rowsOf(3),
    });

    expect(later.fields.visible).toEqual(['name', 'chamber']);
  });

  it('reads back what it wrote', () => {
    const store = fakeStore({
      'listing.printers': JSON.stringify({
        fields: ['name', 'note'],
        view: 'table',
        pageSize: 50,
      }),
    });
    const state = listing(rowsOf(61), { store });

    expect(state.fields.visible).toEqual(['name', 'note']);
    expect(state.view.value).toBe('table');
    expect(state.pager?.pageSize).toBe(50);
  });

  it('opens an untouched listing at the size the appearance settings name', () => {
    viewPreferences.rowsPerPage = 50;

    try {
      expect(listing(rowsOf(61)).pager?.pageSize).toBe(50);

      // A listing this reader has already paged keeps its own size.
      const store = fakeStore({
        'listing.printers': JSON.stringify({ pageSize: 5 }),
      });

      expect(listing(rowsOf(61), { store }).pager?.pageSize).toBe(5);
    } finally {
      viewPreferences.rowsPerPage = DEFAULT_PAGE_SIZE;
    }
  });

  it('ignores a stored view the listing no longer offers', () => {
    const store = fakeStore({
      'listing.printers': JSON.stringify({ view: 'frames' }),
    });
    const state = listing(rowsOf(1), { store });

    expect(state.view.value).toBe('cards');
  });

  it('works when the store refuses, which a private window does', () => {
    const state = listing(rowsOf(61), { store: refusingStore() });

    expect(state.fields.visible).toEqual(['name', 'state']);
    expect(() => {
      state.view.onValueChange('table');
    }).not.toThrow();
    expect(state.view.value).toBe('table');
  });

  it('keeps two listings apart', () => {
    const store = fakeStore();
    const printers = listing(rowsOf(1), { store, id: 'printers' });
    const jobs = listing(rowsOf(1), { store, id: 'jobs' });

    printers.fields.onToggle('state');

    expect(jobs.fields.visible).toEqual(['name', 'state']);
  });
});

describe('ListingState opening shape', () => {
  it('opens in the shape the setting names, over its own initial view', () => {
    const state = listing(rowsOf(1), {
      viewSetting: 'jobs',
      initialView: 'cards',
    });

    expect(state.view.value).toBe('table');
  });

  it('keeps its own initial view where no setting names the listing', () => {
    const state = listing(rowsOf(1), {
      viewSetting: 'no-such-setting',
      initialView: 'table',
    });

    expect(state.view.value).toBe('table');
  });

  it("lets the reader's own choice outrank the setting", () => {
    const store = fakeStore({
      'listing.printers': JSON.stringify({ view: 'cards' }),
    });
    const state = listing(rowsOf(1), {
      store,
      viewSetting: 'jobs',
      initialView: 'table',
    });

    expect(state.view.value).toBe('cards');
  });
});

describe('ListingState with the server paging', () => {
  const served = (
    rows: readonly string[],
    total: number,
    store: ListingStore = fakeStore(),
  ) =>
    new ListingState({
      id: 'printers',
      fields: FIELDS,
      views: VIEWS,
      initialView: 'cards',
      store,
      rows: () => rows,
      total: () => total,
    });

  const dimensionWith = (selected: string[]): FacetDimension => ({
    id: 'state',
    label: 'State',
    values: ['x'],
    counts: new Map(),
    selected,
    onSelectedChange: () => undefined,
  });

  it('neither sorts nor slices, and pages by the total it is told', () => {
    const state = served(['c', 'a', 'b'], 75);

    expect(state.page).toEqual(['c', 'a', 'b']);
    expect(state.total).toBe(75);
    expect(state.pager?.pageCount).toBe(Math.ceil(75 / state.pager!.pageSize));
  });

  it('keeps the page when the same selection is handed in again', () => {
    const state = served([], 500);
    const facet = dimensionWith([]);
    state.setFacets([facet]);
    state.setPage(3);

    state.setFacets([{ ...facet, counts: new Map([['x', 9]]) }]);
    expect(state.pageIndex).toBe(3);

    state.setFacets([{ ...facet, selected: ['x'] }]);
    expect(state.pageIndex).toBe(0);
  });

  it('remembers the sort a reader chose', () => {
    const store = fakeStore();
    served([], 0, store).setSort('name', 'desc');

    expect(served([], 0, store).sort).toEqual({ field: 'name', order: 'desc' });
  });

  it('reads a malformed stored sort as none', () => {
    const store = fakeStore({
      'listing.printers': JSON.stringify({ sort: { field: 1, order: 'up' } }),
    });

    expect(served([], 0, store).sort).toBeUndefined();
  });
});

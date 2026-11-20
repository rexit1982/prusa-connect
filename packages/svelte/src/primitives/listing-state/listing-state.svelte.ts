// What a listing holds on the reader's behalf.
import type { ListField, VisibleFields } from '../field-picker/types';
import type { ListingView } from '../listing-controls/types';
import { PAGE_SIZES, type PageSize } from '../pager/sizes';
import type { PagerControls } from '../pager/types';
import { viewPreferences } from '../view-preferences';
import type {
  FacetDimension,
  ListingStateOptions,
  ListingStore,
} from './types';

export type {
  FacetDimension,
  ListingStateOptions,
  ListingStore,
} from './types';

/** What survives a reload. A filter does not: see the spec. */
interface Held {
  fields?: string[];
  /**
   * Every field the listing had when `fields` was written. A field missing
   * from it came later, so the reader never hid it. A choice written before
   * this key existed has none, and its missing fields stay hidden.
   */
  known?: string[];
  view?: string;
  pageSize?: number;
  sort?: Sort;
}

export interface Sort {
  field: string;
  order: 'asc' | 'desc';
}

const isSort = (value: unknown): value is Sort =>
  typeof value === 'object' &&
  value !== null &&
  'field' in value &&
  typeof value.field === 'string' &&
  'order' in value &&
  (value.order === 'asc' || value.order === 'desc');

const isPageSize = (value: number | undefined): value is PageSize =>
  PAGE_SIZES.some((size) => size === value);

/** A private window throws on storage access rather than answering empty. */
const readHeld = (store: ListingStore, key: string): Held => {
  try {
    const raw = store.read(key);
    if (raw === null) return {};

    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

export class ListingState<Row> {
  #page = $state(0);
  #pageSize = $state<PageSize>(viewPreferences.rowsPerPage);
  #visible = $state.raw<readonly string[]>([]);
  #view = $state('');
  #sort = $state.raw<Sort | undefined>();
  #selection: readonly string[] = [];
  #facets = $state.raw<readonly FacetDimension[]>([]);

  readonly #options: ListingStateOptions<Row>;
  readonly #key: string;

  constructor(options: ListingStateOptions<Row>) {
    this.#options = options;
    this.#key = `listing.${options.id}`;

    const held = readHeld(options.store, this.#key);

    const { fields, known } = held;
    this.#visible =
      fields === undefined
        ? this.#defaults()
        : options.fields
            .filter(
              (field) =>
                fields.includes(field.id) ||
                (known?.includes(field.id) === false &&
                  this.#shownByDefault(field)),
            )
            .map((field) => field.id);

    // The setting is where this listing opens; `held.view` is where this
    // reader last left it, which outranks it.
    const preferred = viewPreferences.defaultView(
      options.viewSetting ?? options.id,
    );
    const opening = options.views.some((view) => view.value === preferred)
      ? (preferred ?? options.initialView)
      : options.initialView;

    this.#view = options.views.some((view) => view.value === held.view)
      ? (held.view ?? opening)
      : opening;

    // A listing this reader has already paged keeps its own size.
    this.#pageSize = isPageSize(held.pageSize)
      ? held.pageSize
      : viewPreferences.rowsPerPage;

    this.#sort = isSort(held.sort) ? held.sort : undefined;
  }

  /** Every field but the ones a reader has to ask for. */
  #defaults(): string[] {
    return this.#options.fields
      .filter((field) => this.#shownByDefault(field))
      .map((field) => field.id);
  }

  #shownByDefault(field: ListField): boolean {
    return field.required === true || field.hiddenByDefault !== true;
  }

  #remember(): void {
    try {
      this.#options.store.write(
        this.#key,
        JSON.stringify({
          fields: [...this.#visible],
          known: this.#options.fields.map((field) => field.id),
          view: this.#view,
          pageSize: this.#pageSize,
          sort: this.#sort,
        }),
      );
    } catch {
      // A browser refusing storage keeps the choice for this visit only.
    }
  }

  get #ordered(): readonly Row[] {
    const rows = this.#options.rows();
    if (this.#options.total !== undefined) return rows;

    const compare = this.#options.compare;

    if (compare === undefined || this.shape === 'hero') return rows;

    return [...rows].sort(compare);
  }

  get shape(): 'hero' | 'fleet' {
    return this.#options.shape?.() ?? 'fleet';
  }

  get total(): number {
    return this.#options.total?.() ?? this.#ordered.length;
  }

  get pageIndex(): number {
    return this.#page;
  }

  setPage(next: number): void {
    this.#page = next;
  }

  get sort(): Sort | undefined {
    return this.#sort;
  }

  setSort(field: string, order: 'asc' | 'desc'): void {
    this.#sort = { field, order };
    this.#remember();
  }

  /** Every row of the listing in its order, on every page. */
  get rows(): readonly Row[] {
    return this.#ordered;
  }

  get page(): readonly Row[] {
    if (this.shape === 'hero' || this.#options.total !== undefined) {
      return this.#ordered;
    }

    const from = this.#page * this.#pageSize;

    return this.#ordered.slice(from, from + this.#pageSize);
  }

  /** `null` on a hero, which has no pager to draw. */
  get pager(): PagerControls | null {
    if (this.shape === 'hero') return null;

    return {
      page: this.#page,
      pageCount: Math.max(1, Math.ceil(this.total / this.#pageSize)),
      pageSize: this.#pageSize,
      onPageChange: (next: number) => {
        this.#page = next;
      },
      onPageSizeChange: (next: PageSize) => {
        this.#pageSize = next;
        // Asking for more at once means the top of the list.
        this.#page = 0;
        this.#remember();
      },
    };
  }

  get fields(): VisibleFields {
    return {
      visible: [...this.#visible],
      onToggle: (id: string) => {
        const field = this.#options.fields.find((one) => one.id === id);
        if (field?.required === true) return;

        this.#visible = this.#visible.includes(id)
          ? this.#visible.filter((held) => held !== id)
          : // Declaration order, so a field toggled back lands where the other
            this.#options.fields
              .map((one) => one.id)
              .filter((one) => one === id || this.#visible.includes(one));
        this.#remember();
      },
      onReset: () => {
        this.#visible = this.#defaults();
        this.#remember();
      },
    };
  }

  get view(): ListingView {
    return {
      value: this.#view,
      options: this.#options.views,
      onValueChange: (next: string) => {
        this.#view = next;
        this.#remember();
      },
    };
  }

  get facets(): readonly FacetDimension[] {
    return this.shape === 'hero' ? [] : this.#facets;
  }

  /** The screen owns what a facet means and hands the dimensions in. */
  setFacets(next: readonly FacetDimension[]): void {
    this.#facets = next;

    // A server-paged screen hands the dimensions back on every response; only
    // a changed selection sends the reader to the first page.
    const selection = next.map((dimension) =>
      dimension.selected.join('\u0000'),
    );
    const changed =
      selection.length !== this.#selection.length ||
      selection.some((one, index) => one !== this.#selection[index]);
    this.#selection = selection;
    if (changed) this.#page = 0;
  }
}

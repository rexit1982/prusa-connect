// The materials one screen lists: the rows, the numbers that frame them, and
// what the person may do with them.
//
// A class, because it is state the page shares with itself across a read and a
// write (svelte-5.md). The service comes in through the constructor, which is
// what lets a test drive it without a network.
import type {
  Brand,
  ListQuery,
  Location,
  MaterialsService,
  Page,
  Row,
} from './api';

/** The grams and the spools the module keeps, whatever the query kept. */
export interface Stock {
  grams: number;
  spools: number;
}

/** The query fields that narrow the list, as against those that page or sort it. */
const FILTERS = [
  'q',
  'brand',
  'type',
  'class',
  'color',
  'favourites',
  'custom',
  'in_stock',
  'assigned',
  'location',
] as const satisfies readonly (keyof ListQuery)[];

/**
 * `rows` is `$state.raw`: a read replaces the list whole and a star replaces
 * one entry, so deep proxying each entry buys nothing (svelte-5.md). The fault
 * is kept as the value that was thrown and never as a sentence, because the
 * code is what a translation is keyed by (frontend-i18n.md rule 5).
 */
export class MaterialList {
  readonly #service: MaterialsService;
  /** The core's answer, and undefined until it gave one. */
  #mayWrite = $state<boolean | undefined>(undefined);
  #rows = $state.raw<readonly Row[]>([]);
  #total = $state(0);
  #next = $state<number | undefined>(undefined);
  #stock = $state.raw<Stock>({ grams: 0, spools: 0 });
  #query = $state.raw<ListQuery>({});
  #brands = $state.raw<readonly Brand[]>([]);
  #types = $state.raw<readonly string[]>([]);
  #locations = $state.raw<readonly Location[]>([]);
  /** The facet read in flight, so two components asking at once make one request. */
  #facets: Promise<void> | undefined;
  #busy = $state(false);
  #loaded = $state(false);
  #fault = $state.raw<unknown>(undefined);
  /** Bumped by every new query, so an answer to an older one can be told. */
  #gen = 0;
  /** The newest read in flight, so two components asking at once make one request. */
  #flight:
    { kind: 'read' | 'more'; gen: number; done: Promise<void> } | undefined;

  constructor(service: MaterialsService, mayOperate: Promise<boolean>) {
    this.#service = service;
    void mayOperate.then((allowed) => {
      this.#mayWrite = allowed;
    });
  }

  /** Whether this person may star a material. False until the core answered. */
  get mayWrite(): boolean {
    return this.#mayWrite === true;
  }

  /**
   * The core said this person may not write. Not the opposite of `mayWrite`:
   * both are false until the core answered, so the note saying so does not
   * appear and vanish under a person who may write.
   */
  get mayOnlyRead(): boolean {
    return this.#mayWrite === false;
  }

  /** The rows read so far. Read-only by design. */
  get rows(): readonly Row[] {
    return this.#rows;
  }

  /** How many rows the whole filtered list holds. */
  get total(): number {
    return this.#total;
  }

  /** The catalogue brands, for the manufacturer filter. Empty until read. */
  get brands(): readonly Brand[] {
    return this.#brands;
  }

  /** The material types, for the type filter. Empty until read. */
  get types(): readonly string[] {
    return this.#types;
  }

  /** The shared locations, for the location filter. Empty until read. */
  get locations(): readonly Location[] {
    return this.#locations;
  }

  /**
   * Reads the brands, the types and the locations. Each screen that offers
   * them asks again when it opens, because an import, a custom material and
   * a location all change them. A failed read keeps what was read before.
   */
  readFacets(): Promise<void> {
    this.#facets ??= (async () => {
      try {
        [this.#brands, this.#types, this.#locations] = await Promise.all([
          this.#service.brands(),
          this.#service.types(),
          this.#service.locations(),
        ]);
      } catch {
        // The filters offer what they had; the list itself is unharmed.
      } finally {
        this.#facets = undefined;
      }
    })();

    return this.#facets;
  }

  /** Where the next page starts, or undefined on the last one. */
  get next(): number | undefined {
    return this.#next;
  }

  /** Every live spool and the grams on them. */
  get stock(): Stock {
    return this.#stock;
  }

  /** What the person narrowed the list to. */
  get query(): ListQuery {
    return this.#query;
  }

  /** Whether any filter narrows the list; the order and the page size do not. */
  get filtered(): boolean {
    return FILTERS.some((key) => key in this.#query);
  }

  /** Whether a filter other than the search narrows the list. */
  get narrowed(): boolean {
    return FILTERS.some((key) => key !== 'q' && key in this.#query);
  }

  /** A call is in flight. */
  get busy(): boolean {
    return this.#busy;
  }

  /** False until the first read answered, which is not the same as an empty list. */
  get loaded(): boolean {
    return this.#loaded;
  }

  /** What the last call threw, and undefined when none did. */
  get fault(): unknown {
    return this.#fault;
  }

  /**
   * Reads the first page. A second call while a read of the same query is in
   * flight is handed its promise, so one screen makes one request for one
   * datum (svelte-data.md).
   */
  read(): Promise<void> {
    if (this.#flight?.kind === 'read' && this.#flight.gen === this.#gen) {
      return this.#flight.done;
    }
    return this.#first();
  }

  /**
   * Narrows the list and reads it from the first row. Whatever was in flight
   * asked the old query, so its answer is let go when it arrives.
   */
  narrow(query: {
    [K in keyof ListQuery]?: ListQuery[K] | undefined;
  }): Promise<void> {
    // A field given as undefined is let go, which is how a filter is cleared.
    this.#query = Object.fromEntries(
      Object.entries({ ...this.#query, ...query }).filter(
        ([, value]) => value !== undefined,
      ),
    );
    return this.#first();
  }

  /** Reads the first page of the query as it stands, letting go of older answers. */
  #first(): Promise<void> {
    this.#gen += 1;

    return this.#start('read', async (query, gen) => {
      const page = await this.#service.list(query);
      if (gen === this.#gen) this.#rows = page.rows;
      return page;
    });
  }

  /** Lets go of every filter and reads the list again. */
  clear(): Promise<void> {
    return this.narrow(
      Object.fromEntries(FILTERS.map((key) => [key, undefined])),
    );
  }

  /** Lets go of every filter but the search, in one read. */
  clearFilters(): Promise<void> {
    return this.narrow(
      Object.fromEntries(
        FILTERS.filter((key) => key !== 'q').map((key) => [key, undefined]),
      ),
    );
  }

  /** Reads the page after the last one and appends it. Nothing on the last page. */
  more(): Promise<void> {
    if (this.#flight?.gen === this.#gen) return this.#flight.done;
    const offset = this.#next;
    if (offset === undefined) return Promise.resolve();

    return this.#start('more', async (query, gen) => {
      const page = await this.#service.list({ ...query, offset });
      if (gen === this.#gen) {
        // The default order follows live stock, so a page read later can
        // repeat a row an earlier one held. Paging stays by offset, so a row
        // can still be skipped; that costs a search, a repeat a broken key.
        const held = this.#rows.map((row) => row.uuid);
        this.#rows = [
          ...this.#rows,
          ...page.rows.filter((row) => !held.includes(row.uuid)),
        ];
      }
      return page;
    });
  }

  /**
   * Stars or unstars one material and reports whether it landed. The row is
   * changed where it stands, so the list does not jump under the pointer; the
   * next read puts the favourites first again.
   */
  async star(uuid: string, on: boolean): Promise<boolean> {
    this.#busy = true;
    this.#fault = undefined;

    try {
      await this.#service.star(uuid, on);
      this.#rows = this.#rows.map((row) =>
        row.uuid === uuid ? { ...row, is_favourite: on } : row,
      );

      return true;
    } catch (thrown) {
      this.#fault = thrown;

      return false;
    } finally {
      // A read or a page still in flight keeps the list busy.
      this.#busy = this.#flight !== undefined;
    }
  }

  /**
   * One read: busy while it runs, the fault kept when it fails. The answer is
   * applied only if no narrowing came after the request went out; a stale one
   * is dropped whole, so rows, total and next always belong to `query`.
   */
  #start(
    kind: 'read' | 'more',
    run: (query: ListQuery, gen: number) => Promise<Page>,
  ): Promise<void> {
    const gen = this.#gen;
    this.#busy = true;
    this.#fault = undefined;

    const flight = {} as {
      kind: 'read' | 'more';
      gen: number;
      done: Promise<void>;
    };
    const done = (async () => {
      try {
        const page = await run(this.#query, gen);
        if (gen !== this.#gen) return;
        this.#total = page.total;
        this.#next = page.next;
        this.#stock = { grams: page.stock_g, spools: page.stock_spools };
        this.#loaded = true;
      } catch (thrown) {
        if (gen === this.#gen) this.#fault = thrown;
      } finally {
        if (this.#flight === flight) this.#flight = undefined;
        if (this.#flight === undefined) this.#busy = false;
      }
    })();
    Object.assign(flight, { kind, gen, done });
    this.#flight = flight;

    return done;
  }
}

// The one list this bundle's pages read.
//
// A module-level holder rather than Svelte context, because the setup function
// runs before any component of this module is mounted. It is set once, in
// `index.ts`.
let held: MaterialList | undefined;

/** Called once by the module's setup function, with the host's signal. */
export const holdList = (list: MaterialList, signal: AbortSignal): void => {
  // A setup that was still running when the person left resumes with a
  // signal that already fired. What it built is not held.
  if (signal.aborted) return;
  held = list;
  signal.addEventListener(
    'abort',
    () => {
      if (held === list) held = undefined;
    },
    { once: true },
  );
};

/** The list the pages read. It throws rather than drawing an empty screen. */
export const heldList = (): MaterialList => {
  if (!held) {
    throw new Error('the materials module drew a page before its setup ran');
  }

  return held;
};

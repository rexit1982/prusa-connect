import type { Component, Snippet } from 'svelte';

import type { DeviceIssues, FleetListing } from '../../data';
import type {
  HomePreference,
  PrinterSeverityTier,
  PrinterState,
} from '../../domain';
import type { ListingStore, PrinterModel } from '../../primitives';
import type { CameraFeed } from '../printer-cameras/types';

/** A column of the listing. A reader puts any of them away. */
export type PrinterFieldId =
  | 'printer'
  | 'state'
  | 'job'
  | 'progress'
  | 'nozzle'
  | 'bed'
  | 'chamber'
  | 'material'
  | 'issue'
  | 'actions';

/**
 * A printer as the listing draws it: the device flattened onto the handful of
 * facts every view needs, so a card, a table cell and a tile read the same
 * values rather than each digging through the state tree.
 *
 * `model` is the machine's own spelling from the handshake, which is what the
 * model facet groups by.
 */
export interface PrinterRow {
  id: string;
  name: string;
  model: string;
  /** The drawing of this machine, which can tell more than `model` names. */
  artwork: PrinterModel;
  state: PrinterState;
  tier: PrinterSeverityTier;
  /** Absent when the machine has never printed. */
  jobName: string | undefined;
  jobThumbnailUrl?: string | undefined;
  jobRunning?: boolean | undefined;
  remaining?: number | undefined;
  filamentTool?: string | undefined;
  /** Whole percent, or `null` when the machine reports none. */
  progress: number | null;
  nozzle: number | undefined;
  nozzleTarget: number | undefined;
  bed: number | undefined;
  bedTarget: number | undefined;
  /** The air inside an enclosed printer. Absent on a printer with no chamber. */
  chamber: number | undefined;
  chamberTarget: number | undefined;
  material: string | undefined;
  /** What is wrong: the vocabulary's sentence, else the machine's own words. */
  statusNote: string | undefined;
  /** What a person does about it, when the vocabulary names it. */
  statusAction: string | undefined;
  /** How loudly the first issue is reported. */
  severity: 'error' | 'info' | 'warning' | undefined;
  /** Present once the printer is retired: why, and when. Its record is history only. */
  retired: { reason: string; at: string } | undefined;
  /** Whether this reader may remove the printer from its card. */
  removable: boolean;
  detailHref: string;
}

/** What a reader may do to one printer. A host that supports none passes none. */
export interface DeviceActions {
  rename?: (id: string, name: string) => Promise<void>;
  retire?: (id: string) => Promise<void>;
  command?: (id: string, verb: string) => Promise<void>;
}

export interface PrinterCardProps {
  row: PrinterRow;
  shows: (field: PrinterFieldId) => boolean;
  actions?: DeviceActions;
  /** Drawn in place of the artwork. The camera slot, unfilled in this round. */
  picture?: Component;
  /** The device-card slot's outlet, drawn under the status when given. */
  line?: Snippet<[deviceId: string]>;
  /** Told each time the card's actions menu opens or shuts. */
  onMenuOpenChange?: ((open: boolean) => void) | undefined;
}

export interface PrinterFrameProps {
  row: PrinterRow;
  /** This printer's camera with its live view, or `undefined` for a printer with no camera. */
  camera?: CameraFeed | undefined;
}

/**
 * What the screen reads of the server's listing. The `FleetListing` store
 * satisfies it, so a product hands its store straight in.
 */
export type FleetListingSource = Pick<
  FleetListing,
  | 'items'
  | 'total'
  | 'filters'
  | 'sorts'
  | 'sort'
  | 'order'
  | 'issues'
  | 'loading'
  | 'loaded'
  | 'error'
  | 'query'
  | 'setQuery'
>;

/**
 * Where the camera of one printer comes from. The host answers the addresses
 * of its frames, and the elements on the page load them with the browser's
 * own cookie; nothing here fetches an image.
 *
 * A printer with no camera answers `undefined`, and the tile then draws its
 * own artwork, which is the design's answer for absence rather than a blank
 * box that would read as a frame still loading.
 */
export interface CameraSource {
  feedFor(deviceId: string): CameraFeed | undefined;
}

/**
 * The tag filter. The chosen tags belong to the host, which keeps them in the
 * address, and go to the server as one more term of the listing's query.
 */
export interface TagFilter {
  /** The chosen tags, spelled as the host holds them. */
  chosen: readonly string[];
  /** Called with the tags the reader chose instead. */
  onChange: (next: string[]) => void;
}

export interface PrintersScreenProps {
  listing: FleetListingSource;
  /** Address of the preview for a file on the printer's storage. */
  thumbnailFor?:
    ((deviceId: string, path: string) => string | undefined) | undefined;
  /** How many printers the whole fleet holds; decides the hero shape and the empty fleet. */
  printerCount: number;
  /** Without it, the screen offers no tag filter. */
  tags?: TagFilter | undefined;
  /**
   * Where the frames view reads a still frame. A host that passes none draws
   * the artwork on every tile, which is what a server with no camera shows.
   */
  cameras?: CameraSource;
  /** `all-printers` by default, so one printer still gets the full listing. */
  preference?: HomePreference;
  onAdd: () => void;
  /** What a reader may do to each printer from its card. */
  actions?: DeviceActions | undefined;
  /** What each issue reason means. Without it a card shows the machine's own words. */
  issues?: Pick<DeviceIssues, 'entryOf'> | undefined;
  store?: ListingStore;
  /** The device-card slot's outlet, drawn on each card in the cards view. */
  cardLine?: Snippet<[deviceId: string]>;
  /**
   * Drawn under the listing, and under the empty fleet too: the printers on
   * the network that are not on this server yet.
   */
  nearby?: Snippet;
}

export interface FleetIssueSummaryProps {
  /** `issues.by_severity` from the listing; undefined draws nothing. */
  counts: Readonly<Record<string, number>> | undefined;
  selected: readonly string[];
  onSelectedChange: (next: string[]) => void;
}

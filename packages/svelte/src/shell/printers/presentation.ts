// The printer as the listing reads it, and the looks a state and a tier pick.
import {
  BED_PATH,
  BED_TARGET_PATH,
  CHAMBER_PATH,
  CHAMBER_TARGET_PATH,
  activeMaterialOf,
  activeToolOf,
  materialOf,
  toolPath,
  currentHeadOf,
  nozzlePath,
  nozzleTargetPath,
  numberAt,
  PRINTER_STATE_SEVERITY_TIER,
  PRINTER_STATE_TONE,
  printerStateOf,
  toolsOf,
  reportedToolIds,
  STATE_PATH,
  textAt,
  type PrinterSeverityTier,
  type PrinterState,
  type PrinterStateTone,
} from '../../domain';
import type { DeviceIssueEntry } from '../../data';
import type { Device } from '../../domain/command';
import { formatDuration, formatNumber, t } from '../../i18n';
import { mayRemove } from '../printer-detail/info/permission';
import {
  PRINTER_MODELS,
  printerModelLabel,
  printerModelName,
  type BadgeVariant,
  type CardTone,
  type ListingStore,
  type PrinterModel,
} from '../../primitives';
import type { PrinterRow } from './types';

/**
 * The address of one printer's page, or of one tab on it. A device id may hold
 * any character, so it is encoded as one path segment.
 */
export const printerHref = (id: string, tab?: string): string => {
  const page = `/printers/${encodeURIComponent(id)}`;

  return tab === undefined ? page : `${page}/${encodeURIComponent(tab)}`;
};

const SNAPSHOT_ONLY = { value: (): undefined => undefined };

/**
 * The tool a printer with a single one uses: `0` when it names no tools at
 * all, none when that one tool sits behind a feeder with slots.
 */
const singleToolOf = (
  device: Device,
  ids: readonly string[],
): string | undefined => {
  if (ids.length === 0 && device.tools === undefined) return '0';
  const [onlyId] = ids;
  if (ids.length !== 1 || onlyId === undefined) return undefined;
  return device.tools?.tools[onlyId]?.feeder?.slot_count ? undefined : onlyId;
};

/**
 * A disconnected machine reports nothing, so its state is read as OFFLINE
 * rather than as the last thing it said before the socket closed.
 */
export const printerRowOf = (
  device: Device,
  issueOf?: (reason: string) => DeviceIssueEntry | undefined,
): PrinterRow => {
  const state = device.connected
    ? printerStateOf(textAt(device, STATE_PATH) ?? 'UNKNOWN')
    : 'OFFLINE';

  const issue = device.issues?.[0];
  const entry = issue === undefined ? undefined : issueOf?.(issue.reason);

  const progress = device.job?.progress;
  const jobRunning = device.job?.running;
  const remainingMs = device.job?.time_remaining_ms;
  const activeTool = activeToolOf(SNAPSHOT_ONLY, device);
  const ids =
    device.tools === undefined
      ? reportedToolIds(device.state)
      : Object.keys(device.tools.tools);
  const candidate = activeTool ?? singleToolOf(device, ids);
  const filamentTool =
    candidate !== undefined &&
    device.connected &&
    device.tools?.tools[candidate] !== null &&
    device.state[toolPath(candidate, 'enabled')] !== false &&
    !device.tools?.tools[candidate]?.feeder?.slot_count &&
    materialOf(SNAPSHOT_ONLY, device, candidate) !== ''
      ? candidate
      : undefined;
  // A print the fleet store invented from a telemetry frame carries an empty
  // name until the record arrives. Empty is no name, as `textAt` reads it.
  const jobName = device.job?.display_name;

  return {
    id: device.id,
    name: device.name,
    model: device.model,
    artwork: printerArtworkOf(device),
    state,
    tier: PRINTER_STATE_SEVERITY_TIER[state],
    jobRunning,
    remaining:
      jobRunning === true &&
      printActivityOf({ state, jobRunning }) === 'active' &&
      typeof remainingMs === 'number' &&
      Number.isFinite(remainingMs) &&
      remainingMs > 0
        ? Math.round(remainingMs / 1000)
        : undefined,
    filamentTool,
    jobName: jobName === '' ? undefined : jobName,
    progress: typeof progress === 'number' ? Math.round(progress) : null,
    // The head printing now, else head 0: the tree is the only place a
    // nozzle is read.
    nozzle: numberAt(device, nozzlePath(currentHeadOf(SNAPSHOT_ONLY, device))),
    nozzleTarget: numberAt(
      device,
      nozzleTargetPath(currentHeadOf(SNAPSHOT_ONLY, device)),
    ),
    bed: numberAt(device, BED_PATH),
    bedTarget: numberAt(device, BED_TARGET_PATH),
    chamber: numberAt(device, CHAMBER_PATH),
    chamberTarget: numberAt(device, CHAMBER_TARGET_PATH),
    // One material for the row: the one the printer prints with now.
    material: activeMaterialOf(SNAPSHOT_ONLY, device),
    statusNote: entry?.summary ?? issue?.detail,
    statusAction: entry?.action,
    severity: issue?.severity,
    retired: device.retired,
    removable: mayRemove(device),
    detailHref: printerHref(device.id),
  };
};

const MODEL_BY_SPELLING: ReadonlyMap<string, PrinterModel> = new Map([
  ...PRINTER_MODELS.map((model) => [model.replaceAll('_', ''), model] as const),
  // TODO: Buddy sends a model name in User-Agent-Printer, the Prusa Connect
  // SDK its type id (HT90: 6.1.0). Key the model on the type id server-side.
  ['610', 'ht90'],
]);

/**
 * Which artwork a machine's own spelling asks for. A printer names its model
 * in the handshake and the spelling is its own: `COREONE`, `Core One` and
 * `CoreOne` are one machine, so the name is folded to letters and digits
 * before the lookup. A spelling no drawing answers is `unknown`, which has
 * artwork of its own.
 */
export const printerModelOf = (model: string): PrinterModel =>
  MODEL_BY_SPELLING.get(model.toLowerCase().replace(/[^a-z0-9]/g, '')) ??
  'unknown';

/**
 * The product name of a machine's own spelling, or that spelling where the
 * app knows no such model, rather than the word "unknown".
 */
export const printerProductNameOf = (model: string): string => {
  const known = printerModelOf(model);

  return known === 'unknown' ? model : printerModelName(known);
};

/** The short name of a machine's own spelling, as printerProductNameOf. */
export const printerModelLabelOf = (model: string): string => {
  const known = printerModelOf(model);

  return known === 'unknown' ? model : printerModelLabel(known);
};

const XL_BY_TOOLS: Readonly<Partial<Record<number, PrinterModel>>> = {
  2: 'xlmultitool2',
  3: 'xlmultitool3',
  4: 'xlmultitool4',
  5: 'xlmultitool5',
};

/**
 * The artwork for one machine. The handshake names an XL `XL` however many
 * toolheads it carries, so the drawing counts the tools the printer reports.
 * The other models with tools are slots behind a filament changer, which
 * the tools alone do not tell from a tool changer.
 */
export const printerArtworkOf = (device: Device): PrinterModel => {
  const model = printerModelOf(device.model);
  if (model !== 'xl') return model;

  return XL_BY_TOOLS[toolsOf(SNAPSHOT_ONLY, device).length] ?? model;
};

const STATE_BADGE_VARIANT: Record<PrinterStateTone, BadgeVariant> = {
  active: 'stateActive',
  busy: 'stateBusy',
  moving: 'stateMoving',
  ready: 'stateReady',
  finished: 'stateFinished',
  stopped: 'stateStopped',
  paused: 'statePaused',
  attention: 'stateAttention',
  fault: 'stateFault',
  idle: 'stateIdle',
  quiet: 'stateQuiet',
  offline: 'stateOffline',
};

/** The badge a state wears, through the tint the domain already gives it. */
export const stateBadgeVariant = (state: PrinterState): BadgeVariant =>
  STATE_BADGE_VARIANT[PRINTER_STATE_TONE[state]];

const SEVERITY_BADGE_VARIANT: Record<
  NonNullable<PrinterRow['severity']>,
  BadgeVariant
> = { error: 'destructive', warning: 'warning', info: 'info' };

/** The badge an issue's severity wears. */
export const severityBadgeVariant = (
  severity: NonNullable<PrinterRow['severity']>,
): BadgeVariant => SEVERITY_BADGE_VARIANT[severity];

/** The word on the badge an issue's severity wears. */
export const SEVERITY_LABEL_KEY: Readonly<
  Record<NonNullable<PrinterRow['severity']>, string>
> = {
  error: 'printers.severity.error',
  warning: 'printers.severity.warning',
  info: 'printers.severity.info',
};

/** Only the two loudest tiers colour a card. The rest stay plain. */
export const cardToneOf = (tier: PrinterSeverityTier): CardTone =>
  tier === 'critical' || tier === 'attention' ? tier : 'default';

/**
 * Where a browser product keeps what a reader chose. `localStorage` throws
 * outright rather than answering null where a browser blocks site data, and
 * `ListingState` guards every call, so the failure is left to it.
 */
export const browserStore = (): ListingStore => ({
  read: (key) => localStorage.getItem(key),
  write: (key, value) => {
    localStorage.setItem(key, value);
  },
});

const RETIRED_REASON_KEY: Readonly<Record<string, string>> = {
  removed_by_operator: 'printers.retired.removed_by_operator',
  ownership_changed: 'printers.retired.ownership_changed',
};

/**
 * Why a printer was retired. The reason is an open value, so one this build
 * does not know is shown as the server spelled it.
 */
export const retiredReasonOf = (reason: string): string => {
  const key = RETIRED_REASON_KEY[reason];

  return key === undefined ? reason : t(key);
};

export const formatRemainingCompact = (seconds: number): string => {
  if (seconds < 60) return formatDuration(seconds);
  const minutes = Math.floor(seconds / 60);

  return minutes >= 60
    ? t('dashboard.printer.remainingHoursCompact', {
        hours: formatNumber(Math.floor(minutes / 60)),
        minutes: formatNumber(minutes % 60),
      })
    : t('dashboard.printer.remainingMinutesCompact', {
        minutes: formatNumber(minutes),
      });
};

/** Whether the available readings establish an active print. */
export const printActivityOf = (
  row: Pick<PrinterRow, 'state' | 'jobRunning'>,
): 'active' | 'inactive' | 'unknown' => {
  if (row.state === 'OFFLINE' || row.state === 'UNKNOWN') return 'unknown';
  if (['IDLE', 'READY', 'FINISHED', 'STOPPED'].includes(row.state))
    return 'inactive';
  if (row.state === 'ERROR')
    return row.jobRunning === false ? 'inactive' : 'unknown';
  if (
    row.state === 'PRINTING' ||
    row.state === 'PAUSED' ||
    row.jobRunning === true
  )
    return 'active';
  return row.jobRunning === false ? 'inactive' : 'unknown';
};

/** The missing-name text, without guessing the machine's current activity. */
export const jobFallbackOf = (
  row: Pick<PrinterRow, 'state' | 'jobRunning'>,
): string | undefined => {
  if (row.state === 'OFFLINE' || row.state === 'UNKNOWN')
    return t('printers.printStatusUnavailable');
  if (
    ['ATTENTION', 'BUSY', 'MANIPULATING'].includes(row.state) &&
    row.jobRunning !== true
  )
    return undefined;
  const activity = printActivityOf(row);
  if (activity === 'inactive') return t('printers.noJob');
  if (activity === 'unknown') return t('printers.printStatusUnavailable');
  return row.jobRunning === true
    ? t('printers.jobNameUnavailable')
    : t('printers.jobDetailsUnavailable');
};

/**
 * The rows in the order `ids` gives, the rows it does not name after them in
 * the order they came. A row `ids` names but the page no longer holds is gone.
 */
export const inHeldOrder = <Row extends { id: string }>(
  rows: readonly Row[],
  ids: readonly string[],
): Row[] => {
  const at = new Map(ids.map((id, index) => [id, index]));
  return [...rows].sort(
    (a, b) => (at.get(a.id) ?? ids.length) - (at.get(b.id) ?? ids.length),
  );
};

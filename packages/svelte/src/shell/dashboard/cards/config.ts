// The settings of each kind of card, as typed values, and the words each
// setting offers.
//
// grid/card-body.svelte holds a card's settings to its declaration in
// declarations.ts before the card receives them (slots/card-settings.ts,
// readCardSettings). A value that breaks the declaration has already taken
// the declaration's default. So these readers only give each checked value
// its type, and each cast below holds for that reason. The bounds and the
// defaults are written once, in declarations.ts.
import type { CardSettings } from '../../../slots';
import type { PrinterOrder } from '../printers';

/** The facts a printer card can show. */
export const PRINTER_FIELDS = [
  'state',
  'job',
  'progress',
  'remaining',
  'nozzle',
  'bed',
  'chamber',
  'material',
  'issue',
] as const;
export type PrinterField = (typeof PRINTER_FIELDS)[number];

/** What stands at the head of a printer card. */
export const PICTURES = ['art', 'camera', 'none'] as const;
export type Picture = (typeof PICTURES)[number];

/** Which printers a card of many holds. */
export const SCOPES = [
  'all',
  'printing',
  'attention',
  'idle',
  'offline',
] as const;
export type Scope = (typeof SCOPES)[number];

/** How large each printer is drawn inside a card of many. */
export const SIZES = ['tile', 'row'] as const;
export type Size = (typeof SIZES)[number];

/** The heaters a chart can draw. */
export const HEATERS = ['nozzle', 'bed'] as const;
export type Heater = (typeof HEATERS)[number];

/** How far back a chart reaches, in minutes. */
export const SPANS = [5, 15, 30, 60] as const;
export type Span = (typeof SPANS)[number];

/** How large the words of a note are. */
export const NOTE_SIZES = ['sm', 'md', 'lg', 'xl'] as const;
export type NoteSize = (typeof NOTE_SIZES)[number];

/** The tint a note wears, from the state tints of the theme. */
export const TONES = [
  'plain',
  'active',
  'done',
  'idle',
  'attention',
  'fault',
] as const;
export type Tone = (typeof TONES)[number];

export const ALIGNS = ['start', 'center'] as const;
export type Align = (typeof ALIGNS)[number];

/**
 * Which printers a card of many starts from: the printers a person chose, or
 * every printer when they chose none. The tag narrows either.
 */
const selectionOf = (settings: CardSettings) => ({
  devices: settings.devices as readonly string[],
  /** Only printers with this tag, or every printer when empty. */
  tag: settings.tag as string,
});

export const printerSettings = (settings: CardSettings) => ({
  /** The printer, or empty until a person picks one. */
  device: settings.device as string,
  fields: settings.fields as readonly PrinterField[],
  picture: settings.picture as Picture,
});

export const printersSettings = (settings: CardSettings) => ({
  ...selectionOf(settings),
  scope: settings.scope as Scope,
  order: settings.order as PrinterOrder,
  size: settings.size as Size,
  fields: settings.fields as readonly PrinterField[],
});

/** The settings of a card that counts or lists the printers it selects. */
export const tagSettings = selectionOf;

export const finishingSettings = (settings: CardSettings) => ({
  ...selectionOf(settings),
  /** How many prints the card lists at most. */
  limit: settings.limit as number,
});

export const temperatureSettings = (settings: CardSettings) => ({
  device: settings.device as string,
  heaters: settings.heaters as readonly Heater[],
  // The settings form keeps a choice as a word, so the span is one of the
  // words of SPANS.
  minutes: Number(settings.minutes) as Span,
});

export const cameraSettings = (settings: CardSettings) => ({
  /** The camera, or empty until a person picks one. */
  camera: settings.camera as string,
});

export const noteSettings = (settings: CardSettings) => ({
  text: settings.text as string,
  size: settings.size as NoteSize,
  tone: settings.tone as Tone,
  align: settings.align as Align,
});

export const clockSettings = (settings: CardSettings) => ({
  seconds: settings.seconds as boolean,
  date: settings.date as boolean,
});

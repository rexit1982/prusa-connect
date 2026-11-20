// The catalogue key behind every word a settings form offers, as static maps
// (frontend-i18n.md rule 2). A key built from a value at run time could name
// a line no catalogue holds, and the gate would not see it.
import type { PrinterOrder } from '../printers';
import type {
  Align,
  Heater,
  NoteSize,
  Picture,
  PrinterField,
  Scope,
  Size,
  Tone,
} from './config';

export const FIELD: Readonly<Record<PrinterField, string>> = {
  state: 'dashboard.field.state',
  job: 'dashboard.field.job',
  progress: 'dashboard.field.progress',
  remaining: 'dashboard.field.remaining',
  nozzle: 'dashboard.field.nozzle',
  bed: 'dashboard.field.bed',
  chamber: 'dashboard.field.chamber',
  material: 'dashboard.field.material',
  issue: 'dashboard.field.issue',
};

export const PICTURE: Readonly<Record<Picture, string>> = {
  art: 'dashboard.picture.art',
  camera: 'dashboard.picture.camera',
  none: 'dashboard.picture.none',
};

export const SCOPE: Readonly<Record<Scope, string>> = {
  all: 'dashboard.printers.scope.all',
  printing: 'dashboard.printers.scope.printing',
  attention: 'dashboard.printers.scope.attention',
  idle: 'dashboard.printers.scope.idle',
  offline: 'dashboard.printers.scope.offline',
};

export const ORDER: Readonly<Record<PrinterOrder, string>> = {
  name: 'dashboard.order.name',
  state: 'dashboard.order.state',
  remaining: 'dashboard.order.remaining',
};

export const SIZE: Readonly<Record<Size, string>> = {
  tile: 'dashboard.size.tile',
  row: 'dashboard.size.row',
};

export const HEATER: Readonly<Record<Heater, string>> = {
  nozzle: 'dashboard.temperature.nozzle',
  bed: 'dashboard.temperature.bed',
};

export const NOTE_SIZE: Readonly<Record<NoteSize, string>> = {
  sm: 'dashboard.noteSize.sm',
  md: 'dashboard.noteSize.md',
  lg: 'dashboard.noteSize.lg',
  xl: 'dashboard.noteSize.xl',
};

export const TONE: Readonly<Record<Tone, string>> = {
  plain: 'dashboard.tone.plain',
  active: 'dashboard.tone.active',
  done: 'dashboard.tone.done',
  idle: 'dashboard.tone.idle',
  attention: 'dashboard.tone.attention',
  fault: 'dashboard.tone.fault',
};

export const ALIGN: Readonly<Record<Align, string>> = {
  start: 'dashboard.align.start',
  center: 'dashboard.align.center',
};

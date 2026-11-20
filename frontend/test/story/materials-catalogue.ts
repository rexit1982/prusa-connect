import type { components } from '../../../extensions/materials/client/src/generated/module-api';
import { json, problem } from '../../src/test/stub';
import { fleetOf, type DeviceJson } from '../../.storybook/fleet';
import catalogueSample from './assets/materials-catalogue.json';
import type { Overrides } from './api';

type Schema = components['schemas'];
type Spool = Schema['Spool'];
type Material = Schema['CatalogueMaterial'] & { color_family: string };
interface Snapshot {
  meta: Schema['CatalogueMeta'];
  brands: Schema['Brand'][];
  materials: Material[];
  packages: Schema['Package'][];
}

export const materialId = '1aaca54a-431f-5601-adf5-85dd018f487f';
export const materialsApi = '/api/v1/modules/com.github.aux.prusa3d.materials';
export const materialsList = 'GET ' + materialsApi + '/materials';

const locations = {
  1: 'Filament cabinet',
  2: 'Dry box A',
  3: 'Shelf B2',
} as const;

const printers = fleetOf('many');
const printerBySerial = new Map(
  printers.map((printer) => [printer.serial, printer]),
);

type SpoolSample = {
  id: number;
  remaining: number;
  note?: string;
} & (
  | { location: keyof typeof locations; printer?: never }
  | { location?: never; printer: string; tool: string }
);

interface PackageSample {
  emptyWeight?: number;
  spools: SpoolSample[];
}

// Stock is simulated. Package dimensions and weights come from the catalogue
// where available. Other tare weights represent sample measurements.
const spoolSamples: Record<string, PackageSample> = {
  'prusament-pla-prusa-galaxy-black-1000-spool': {
    spools: [
      { id: 1, remaining: 1000, location: 1, note: 'Sealed spare.' },
      {
        id: 2,
        remaining: 642,
        printer: 'DEMO-01',
        tool: '0.4',
        note: 'Opened for the enclosure batch.',
      },
      {
        id: 3,
        remaining: 38,
        location: 3,
        note: 'Keep for first-layer tests.',
      },
    ],
  },
  'prusament-pla-prusa-galaxy-black-2000-spool': {
    spools: [
      {
        id: 4,
        remaining: 1475,
        location: 3,
        note: 'Reserved for large parts.',
      },
    ],
  },
  'polymaker-panchroma-matte-pla-lavender-purple-1000-spool': {
    spools: [
      { id: 5, remaining: 1000, location: 1, note: 'Unopened.' },
      {
        id: 6,
        remaining: 286,
        printer: 'DEMO-03',
        tool: '0',
        note: 'Opened for colour samples.',
      },
    ],
  },
  'sunlu-pla-yellow-1kg': {
    spools: [
      { id: 7, remaining: 725, location: 1 },
      {
        id: 8,
        remaining: 112,
        printer: 'DEMO-05',
        tool: '0.2',
        note: 'Use for small labels.',
      },
    ],
  },
  'bambulab-petg-hf-blue-1kg': {
    emptyWeight: 250,
    spools: [
      { id: 9, remaining: 864, location: 2, note: 'Dried before printing.' },
    ],
  },
  'sainsmart-blue-flexible-tpu-800g': {
    emptyWeight: 182,
    spools: [
      { id: 10, remaining: 205, location: 2, note: 'Store with desiccant.' },
    ],
  },
  'formfutura-carbonfil-black-250g': {
    emptyWeight: 120,
    spools: [
      { id: 11, remaining: 190, location: 3, note: 'Use a hardened nozzle.' },
    ],
  },
  'fillamentum-pla-extrafill-everybodys-magenta-750g': {
    emptyWeight: 230,
    spools: [{ id: 12, remaining: 512, location: 1 }],
  },
};

function stockOf(spools: Spool[]) {
  return {
    spools: spools.length,
    assigned_spools: spools.filter((spool) => spool.tool !== null).length,
    remaining_g: spools.reduce(
      (sum, spool) => sum + spool.remaining_weight_g,
      0,
    ),
    free_g: spools
      .filter((spool) => spool.tool === null)
      .reduce((sum, spool) => sum + spool.remaining_weight_g, 0),
    ...(spools.length > 0 && {
      capacity_g: spools.reduce(
        (sum, spool) =>
          sum + (spool.full_weight_g ?? 0) - (spool.empty_weight_g ?? 0),
        0,
      ),
    }),
  };
}

function readCatalogue(snapshot: Snapshot) {
  const brands = new Map(
    snapshot.brands.map((brand) => [brand.slug, brand.name]),
  );
  const packages = new Map<string, Snapshot['packages']>();
  for (const item of snapshot.packages) {
    const held = packages.get(item.material_slug);
    if (held) held.push(item);
    else packages.set(item.material_slug, [item]);
  }
  const records = snapshot.materials.map((material) => {
    const brand = brands.get(material.brand_slug) ?? '';
    const spools = (packages.get(material.slug) ?? [])
      .flatMap((pkg): Spool[] => {
        const sample = spoolSamples[pkg.slug];
        if (!sample || pkg.net_weight_g === undefined) return [];
        const emptyWeight = pkg.empty_weight_g ?? sample.emptyWeight;
        const fullWeight = pkg.net_weight_g + (emptyWeight ?? 0);
        return sample.spools.map((sample): Spool => {
          const { id, remaining, location, note } = sample;
          let tool: Spool['tool'] = null;
          if (sample.printer !== undefined) {
            const printer = printerBySerial.get(sample.printer);
            if (printer === undefined) {
              throw new Error('Missing Storybook printer: ' + sample.printer);
            }
            tool = { device_id: printer.id, tool_id: sample.tool, gone: false };
          }
          return {
            id,
            uuid: `d758ba71-43a7-493d-9afd-${String(id).padStart(12, '0')}`,
            source: 'manual',
            material_uuid: material.uuid,
            material_source: 'catalogue',
            material_name: material.name,
            brand_name: brand,
            class: material.class,
            type: material.type,
            color_rgba: material.color_rgba,
            ...(material.density !== undefined && {
              density: material.density,
            }),
            package_uuid: pkg.uuid,
            ...(pkg.diameter_um !== undefined && {
              diameter_um: pkg.diameter_um,
            }),
            ...(pkg.length_mm !== undefined && { length_mm: pkg.length_mm }),
            full_weight_g: fullWeight,
            ...(emptyWeight !== undefined && { empty_weight_g: emptyWeight }),
            remaining_weight_g: remaining,
            ...(location !== undefined && { location_id: location }),
            location: location === undefined ? '' : locations[location],
            notes: note ?? '',
            created_by: 'demo',
            created_at: '2026-10-26T08:30:00Z',
            updated_at: '2026-11-12T15:40:00Z',
            archived_at: null,
            tool,
          };
        });
      })
      .sort((a, b) => a.id - b.id);
    const row: Schema['Row'] = {
      uuid: material.uuid,
      name: material.name,
      brand_name: brand,
      class: material.class,
      type: material.type,
      color_rgba: material.color_rgba,
      is_favourite: false,
      is_custom: false,
      ...stockOf(spools),
    };
    return { material, row, spools };
  });
  return {
    meta: snapshot.meta,
    brands: snapshot.brands,
    packages,
    records,
    byId: new Map(records.map((record) => [record.row.uuid, record])),
    types: [
      ...new Set(records.map(({ row }) => row.type).filter(Boolean)),
    ].sort(),
  };
}

const catalogue = readCatalogue(catalogueSample);
const fixtureSpools = catalogue.records.flatMap((record) => record.spools);
const STORAGE_KEY = 'prusa.storybook.materials.assignments';
type SpoolPlaces = Record<number, Spool['tool']>;
interface Assignments {
  spools: SpoolPlaces;
  materials: Record<string, string>;
  favourites?: Record<string, boolean>;
  custom?: Record<string, Schema['CustomMaterial']>;
  addedSpools?: Spool[];
  addedLocations?: Record<number, string>;
}
const positionKey = (device: string, tool: string) => `${device}/${tool}`;

function assignments(): Assignments {
  try {
    return (
      (JSON.parse(
        globalThis.sessionStorage.getItem(STORAGE_KEY) ?? 'null',
      ) as Assignments | null) ?? { spools: {}, materials: {} }
    );
  } catch {
    return { spools: {}, materials: {} };
  }
}

function customDetail(
  stored: Assignments,
  uuid: string,
): Schema['Detail'] | undefined {
  const custom = stored.custom?.[uuid];
  if (!custom) return undefined;
  return {
    uuid,
    name: custom.name,
    brand_name: custom.brand_name ?? '',
    class: custom.class,
    type: custom.type ?? '',
    color_rgba: custom.color_rgba ?? '',
    is_favourite: stored.favourites?.[uuid] === true,
    is_custom: true,
    ...stockOf(
      currentSpools(stored).filter((spool) => spool.material_uuid === uuid),
    ),
    custom,
    packages: [],
  };
}

function currentLocations(stored = assignments()): Record<number, string> {
  return { ...locations, ...stored.addedLocations };
}

function currentSpools(stored = assignments()): Spool[] {
  const saved = stored.spools;
  return [...fixtureSpools, ...(stored.addedSpools ?? [])].map((spool) => ({
    ...spool,
    tool: Object.hasOwn(saved, spool.id)
      ? (saved[spool.id] ?? null)
      : spool.tool,
  }));
}

function printerView(printer: DeviceJson): Schema['Printer'] {
  const state = printer.state['/state'];
  return {
    id: printer.id,
    name: printer.name,
    model: printer.model,
    state: typeof state === 'string' ? state : '',
    connected: printer.connected === true,
    may_operate: true,
  };
}

function toolsFor(printer: DeviceJson): Schema['Tool'][] {
  const stored = assignments();
  const placed = currentSpools(stored);
  return Object.entries(printer.tools?.tools ?? {}).flatMap(
    ([id, tool]): Schema['Tool'][] => {
      if (tool.feeder) return [];
      const spool = placed.find(
        ({ tool }) => tool?.device_id === printer.id && tool.tool_id === id,
      );
      const assigned = stored.materials[positionKey(printer.id, id)] ?? '';
      const record = catalogue.byId.get(assigned);
      const custom = customDetail(stored, assigned);
      const material = record?.row ?? custom;
      const kind = id.includes('.') ? 'slot' : 'head';
      const refusal = printer.state['/state'] === 'PRINTING' ? 'printing' : '';
      const materialAssignment: Schema['Tool']['assignment'] = material
        ? {
            device_id: printer.id,
            tool_id: id,
            material_uuid: material.uuid,
            material_source: custom ? 'custom' : 'catalogue',
            material_name: material.name,
            brand_name: material.brand_name,
            type: material.type,
            abbreviation:
              record?.material.abbreviation ??
              custom?.custom?.abbreviation ??
              '',
            color_rgba: material.color_rgba,
            by: 'person',
            updated_at: '2026-11-15T09:00:00Z',
          }
        : null;
      return [
        {
          id,
          kind,
          ...(kind === 'slot' && { feeder: 'MMU3' }),
          active: printer.state[`/tools/${id}/active`] === true,
          nozzle: { diameter_mm: tool.features.nozzle_diameter },
          from_nfc: false,
          reported: null,
          assign: refusal,
          unassign: refusal,
          assignment: spool
            ? {
                device_id: printer.id,
                tool_id: id,
                material_uuid: spool.material_uuid,
                material_source: spool.material_source,
                material_name: spool.material_name,
                brand_name: spool.brand_name,
                type: spool.type,
                abbreviation: spool.type,
                color_rgba: spool.color_rgba,
                spool_id: spool.id,
                by: 'person',
                updated_at: spool.updated_at,
              }
            : materialAssignment,
        },
      ];
    },
  );
}

// Match SQLite's ASCII folding and use the export's stable name/UUID order
// as the tiebreaker for secondary sort columns.
const fold = (value: string) =>
  value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const compare = (a: string, b: string) => Number(a > b) - Number(a < b);
const fields = { brand: 'brand_name', name: 'name', type: 'type' } as const;

// The story mirrors the Materials colour families for locally created rows.
function customColour(hex: string): string | undefined {
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return undefined;
  if (hex.length === 9 && Number.parseInt(hex.slice(7), 16) < 128)
    return 'natural';

  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const lightness = (high + low) / 2;
  const spread = high - low;
  if (lightness < 0.15) return 'black';
  if (lightness > 0.9) return 'white';
  if (spread === 0 || spread / (1 - Math.abs(2 * lightness - 1)) < 0.15)
    return 'grey';

  let hue = (green - blue) / spread;
  if (high === green) hue = 2 + (blue - red) / spread;
  else if (high === blue) hue = 4 + (red - green) / spread;
  hue = (hue * 60 + 360) % 360;
  if (hue < 10 || hue >= 345) return 'red';
  if (hue < 40) return lightness < 0.45 ? 'brown' : 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 170) return 'green';
  if (hue < 255) return 'blue';
  if (hue < 315) return 'purple';
  return 'pink';
}

function page(query: URLSearchParams) {
  const stored = assignments();
  const favourites = stored.favourites;
  const allSpools = currentSpools(stored);
  const records = catalogue.records.map((record) => {
    const spools = allSpools.filter(
      (spool) => spool.material_uuid === record.row.uuid,
    );
    return {
      ...record,
      spools,
      row: {
        ...record.row,
        is_favourite: favourites?.[record.row.uuid] === true,
        ...stockOf(spools),
      },
    };
  });
  const stock = stockOf(allSpools);
  const search = fold(query.get('q')?.trim() ?? '');
  const brand = query.get('brand');
  const type = query.get('type');
  const kind = query.get('class');
  const color = query.get('color');
  const on = (key: string) => ['true', '1'].includes(query.get(key) ?? '');
  const location = Number(query.get('location'));
  const rows = on('custom')
    ? []
    : records
        .filter(
          ({ material, row, spools }) =>
            (!on('favourites') || row.is_favourite) &&
            (!brand || material.brand_slug === brand) &&
            (!type || row.type === type) &&
            (!kind || row.class === kind) &&
            (!color || material.color_family === color) &&
            (!on('in_stock') || row.spools > 0) &&
            (!on('assigned') || row.assigned_spools > 0) &&
            (!location ||
              spools.some((spool) => spool.location_id === location)) &&
            (!search ||
              [row.name, row.brand_name, row.type, material.abbreviation].some(
                (value) => fold(value).includes(search),
              )),
        )
        .map(({ row, spools }) =>
          location
            ? {
                ...row,
                ...stockOf(
                  spools.filter((spool) => spool.location_id === location),
                ),
              }
            : row,
        );
  for (const [uuid, material] of Object.entries(stored.custom ?? {})) {
    const row = customDetail(stored, uuid);
    const stock = stockOf(
      allSpools.filter(
        (spool) =>
          spool.material_uuid === uuid &&
          (!location || spool.location_id === location),
      ),
    );
    if (
      row &&
      (!on('favourites') || row.is_favourite) &&
      (!brand ||
        catalogue.brands.find((item) => item.slug === brand)?.name ===
          row.brand_name) &&
      (!color || customColour(row.color_rgba) === color) &&
      (!type || row.type === type) &&
      (!kind || row.class === kind) &&
      (!(on('in_stock') || location) || stock.spools > 0) &&
      (!on('assigned') ||
        stock.assigned_spools > 0 ||
        Object.values(stored.materials).includes(uuid)) &&
      (!search ||
        [row.name, row.brand_name, row.type, material.abbreviation ?? ''].some(
          (value) => fold(value).includes(search),
        ))
    )
      rows.push({ ...row, ...stock });
  }
  const order = query.get('order');
  if (order === 'name' || order === 'brand' || order === 'type') {
    const field = fields[order];
    const direction = on('desc') ? -1 : 1;
    rows.sort((a, b) => direction * compare(fold(a[field]), fold(b[field])));
  }
  if (!order || order === 'relevance') {
    // The module's own order: favourites, filament to load, most first,
    // custom materials, the rest.
    rows.sort(
      (a, b) =>
        Number(b.is_favourite) - Number(a.is_favourite) ||
        (a.is_favourite ? 0 : b.free_g - a.free_g) ||
        Number(b.is_custom) - Number(a.is_custom),
    );
  }
  const offset = Math.max(0, Math.trunc(Number(query.get('offset')) || 0));
  const limit = Math.min(
    100,
    Math.max(1, Math.trunc(Number(query.get('limit')) || 25)),
  );
  const end = offset + limit;
  return json(200, {
    rows: rows.slice(offset, end),
    total: rows.length,
    ...(end < rows.length && { next: end }),
    stock_g: stock.remaining_g,
    stock_spools: stock.spools,
  });
}

export const materialsReadings: Overrides = {
  [materialsList]: page,
  ['GET ' + materialsApi + '/printers']: (query) => {
    const ids = query.getAll('id').flatMap((id) => id.split(','));
    const search = fold(query.get('q')?.trim() ?? '');
    const available = printers
      .filter(
        ({ id, name, model }) =>
          (ids.length === 0 || ids.includes(id)) &&
          [id, name, model].some((value) => fold(value).includes(search)),
      )
      .map(printerView)
      .sort((a, b) => compare(fold(a.name), fold(b.name)));
    const offset = Math.max(0, Number(query.get('offset')) || 0);
    const limit = Math.min(100, Math.max(1, Number(query.get('limit')) || 100));
    const end = offset + limit;
    return json(200, {
      printers: available.slice(offset, end),
      ...(end < available.length && { next: end }),
    });
  },
  ['GET ' + materialsApi + '/catalogue']: () =>
    json(200, {
      loaded: true,
      meta: catalogue.meta,
      import: { phase: 'idle' },
    }),
  ['GET ' + materialsApi + '/catalogue/brands']: () =>
    json(200, { brands: catalogue.brands }),
  ['GET ' + materialsApi + '/types']: () =>
    json(200, { types: catalogue.types }),
  ['GET ' + materialsApi + '/locations']: () =>
    json(200, {
      locations: Object.entries(currentLocations()).map(([id, name]) => ({
        id: Number(id),
        name,
        spools: currentSpools().filter(
          (spool) => spool.location_id === Number(id),
        ).length,
      })),
    }),
  ['GET ' + materialsApi + '/list-filters']: () => json(200, { filters: {} }),
  ['PUT ' + materialsApi + '/list-filters']: () =>
    new Response(null, { status: 204 }),
  ['POST ' + materialsApi + '/catalogue/download']: () =>
    json(200, {
      loaded: true,
      meta: catalogue.meta,
      import: {
        phase: 'idle',
        finished: new Date().toISOString(),
        unchanged: true,
      },
    }),
};

export function materialReading(
  path: string,
  body?:
    | Schema['AssignRequest']
    | Schema['MaterialFields']
    | Schema['SpoolsDraft']
    | { name: string },
) {
  if (
    path === 'POST ' + materialsApi + '/custom-materials' &&
    body &&
    'class' in body
  ) {
    const uuid = globalThis.crypto.randomUUID();
    const now = new Date().toISOString();
    const stored = assignments();
    stored.custom = {
      ...stored.custom,
      [uuid]: { ...body, uuid, created_at: now, updated_at: now },
    };
    globalThis.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return json(201, { uuid });
  }
  if (
    path === 'POST ' + materialsApi + '/spools' &&
    body &&
    'quantity' in body
  ) {
    const stored = assignments();
    const row =
      catalogue.byId.get(body.material_uuid)?.row ??
      customDetail(stored, body.material_uuid);
    if (!row) return problem(404, 'materials/NOT_FOUND');
    const nextId =
      1 + Math.max(0, ...currentSpools(stored).map((spool) => spool.id));
    const now = new Date().toISOString();
    const location =
      body.location_id === undefined
        ? ''
        : (currentLocations(stored)[body.location_id] ?? '');
    const added: Spool[] = Array.from(
      { length: body.quantity },
      (_, index) => ({
        id: nextId + index,
        uuid: globalThis.crypto.randomUUID(),
        source: 'manual',
        material_uuid: row.uuid,
        material_source: row.is_custom ? 'custom' : 'catalogue',
        material_name: row.name,
        brand_name: row.brand_name,
        class: row.class,
        type: row.type,
        color_rgba: row.color_rgba,
        ...(body.package_uuid !== undefined && {
          package_uuid: body.package_uuid,
        }),
        ...(body.full_weight_g !== undefined && {
          full_weight_g: body.full_weight_g,
        }),
        ...(body.empty_weight_g !== undefined && {
          empty_weight_g: body.empty_weight_g,
        }),
        ...(body.length_mm !== undefined && { length_mm: body.length_mm }),
        ...(body.location_id !== undefined && {
          location_id: body.location_id,
        }),
        remaining_weight_g: body.remaining_weight_g,
        location,
        notes: body.notes ?? '',
        created_by: 'demo',
        created_at: now,
        updated_at: now,
        archived_at: null,
        tool: null,
      }),
    );
    stored.addedSpools = [...(stored.addedSpools ?? []), ...added];
    globalThis.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return json(201, {
      added: added.length,
      ids: added.map((spool) => spool.id),
    });
  }
  if (
    path === 'POST ' + materialsApi + '/locations' &&
    body &&
    'name' in body
  ) {
    const stored = assignments();
    const id =
      1 + Math.max(...Object.keys(currentLocations(stored)).map(Number));
    stored.addedLocations = { ...stored.addedLocations, [id]: body.name };
    globalThis.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return json(201, { id, name: body.name, spools: 0 });
  }
  const assignment =
    body && !('name' in body) && !('quantity' in body) ? body : undefined;
  const favourite = /^(PUT|DELETE) (.+)\/favourites\/([^/]+)$/.exec(path);
  if (favourite?.[2] === materialsApi) {
    const [, method, , uuid] = favourite;
    if (
      uuid === undefined ||
      (!catalogue.byId.has(uuid) && !customDetail(assignments(), uuid))
    )
      return problem(404, 'materials/NOT_FOUND');
    const stored = assignments();
    stored.favourites = { ...stored.favourites, [uuid]: method === 'PUT' };
    globalThis.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return new Response(null, { status: 204 });
  }
  const change = /^(PUT|DELETE) (.+)\/printers\/([^/]+)\/tools\/([^/]+)$/.exec(
    path,
  );
  if (change?.[2] === materialsApi) {
    const [, method, , deviceId, toolId] = change;
    const printer = printers.find(({ id }) => id === deviceId);
    const tool = printer && toolsFor(printer).find(({ id }) => id === toolId);
    if (!printer || !tool) return problem(404, 'materials/NOT_FOUND');
    if (tool.assign) return problem(409, 'materials/TOOL_REFUSED');
    const held = tool.assignment?.spool_id;
    const stored = assignments();
    const position = positionKey(printer.id, tool.id);
    if (method === 'DELETE') {
      if (held !== undefined) stored.spools[held] = null;
      stored.materials[position] = '';
    } else if (assignment?.spool_id !== undefined) {
      const spool = currentSpools(stored).find(
        ({ id }) => id === assignment.spool_id,
      );
      if (!spool) return problem(404, 'materials/NOT_FOUND');
      if (spool.tool != null && spool.id !== held)
        return problem(409, 'materials/SPOOL_ASSIGNED');
      if (held !== undefined) stored.spools[held] = null;
      stored.spools[spool.id] = {
        device_id: printer.id,
        tool_id: tool.id,
        gone: false,
      };
      stored.materials[position] = '';
    } else if (
      assignment?.material_uuid &&
      (catalogue.byId.has(assignment.material_uuid) ||
        customDetail(stored, assignment.material_uuid))
    ) {
      if (held !== undefined) stored.spools[held] = null;
      stored.materials[position] = assignment.material_uuid;
    } else {
      return problem(404, 'materials/NOT_FOUND');
    }
    globalThis.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return method === 'DELETE'
      ? new Response(null, { status: 204 })
      : json(
          200,
          toolsFor(printer).find(({ id }) => id === toolId)?.assignment,
        );
  }

  const toolsPath = 'GET ' + materialsApi + '/printers/';
  if (path.startsWith(toolsPath) && path.endsWith('/tools')) {
    const id = path.slice(toolsPath.length, -'/tools'.length);
    const printer = printers.find((device) => device.id === id);
    return printer
      ? json(200, { ...printerView(printer), tools: toolsFor(printer) })
      : problem(404, 'materials/NOT_FOUND');
  }
  const prefix = 'GET ' + materialsApi + '/materials/';
  if (!path.startsWith(prefix)) return undefined;
  const [uuid, child, ...rest] = path.slice(prefix.length).split('/');
  if (
    uuid === undefined ||
    rest.length > 0 ||
    (child !== undefined && child !== 'spools')
  )
    return undefined;
  const snapshot = catalogue;
  const record = snapshot.byId.get(uuid);
  const active = currentSpools().filter(
    (spool) => spool.material_uuid === uuid,
  );
  if (!record) {
    const custom = customDetail(assignments(), uuid);
    if (!custom) return problem(404, 'materials/NOT_FOUND');
    return json(
      200,
      child === 'spools' ? { total: active.length, spools: active } : custom,
    );
  }
  return child === 'spools'
    ? json(200, { total: active.length, spools: active })
    : json(200, {
        ...record.row,
        is_favourite: assignments().favourites?.[uuid] === true,
        ...stockOf(active),
        material: record.material,
        packages: snapshot.packages.get(record.material.slug) ?? [],
      });
}

import { describe, expect, it } from 'vitest';

import type { Detail } from '../api';
import { SpoolDraftForm } from './draft.svelte';

const detail: Detail = {
  uuid: 'm1',
  name: 'Galaxy Black',
  brand_name: 'Prusament',
  class: 'FFF',
  type: 'PLA',
  color_rgba: '#3d3e3dff',
  is_favourite: false,
  is_custom: false,
  spools: 0,
  assigned_spools: 0,
  remaining_g: 0,
  free_g: 0,
  packages: [
    {
      uuid: 'p1',
      slug: 'galaxy-black-1kg',
      class: 'FFF',
      material_slug: 'galaxy-black',
      container_slug: 'prusament-spool',
      gtin: '',
      container_name: 'Prusament spool',
      net_weight_g: 1000,
      empty_weight_g: 193,
      length_mm: 330000,
    },
  ],
};

const chosen = (): SpoolDraftForm => {
  const draft = new SpoolDraftForm();
  draft.choose(detail);

  return draft;
};

describe('the spool draft', () => {
  it('moves to step 2 with the material chosen', () => {
    const draft = chosen();
    expect(draft.step).toBe(2);
    expect(draft.material?.uuid).toBe('m1');
  });

  it('fills the weights and the length from a package', () => {
    const draft = chosen();
    draft.choosePackage('p1');
    expect(draft.packageUuid).toBe('p1');
    expect(draft.fullWeightG).toBe(1193);
    expect(draft.emptyWeightG).toBe(193);
    expect(draft.lengthMM).toBe(330000);
    expect(draft.netG).toBe(1000);
  });

  it('gives a spool with nothing typed left the full weight less the empty one', () => {
    const draft = chosen();
    draft.fullWeightG = 1250;
    draft.emptyWeightG = 250;
    expect(draft.valid).toBe(true);
    expect(draft.body()).toMatchObject({
      material_uuid: 'm1',
      remaining_weight_g: 1000,
      quantity: 1,
    });
    expect(draft.body()).not.toHaveProperty('condition');
  });

  it('asks for what is left without a net weight, and no more than the net', () => {
    const draft = chosen();
    expect(draft.valid).toBe(false);
    draft.remainingG = 400;
    expect(draft.valid).toBe(true);
    draft.choosePackage('p1');
    expect(draft.valid).toBe(true);
    expect(draft.body().remaining_weight_g).toBe(400);
    draft.remainingG = 1001;
    expect(draft.valid).toBe(false);
  });

  it('takes a quantity from 1 to 100', () => {
    const draft = chosen();
    draft.choosePackage('p1');
    for (const [quantity, valid] of [
      [0, false],
      [1, true],
      [100, true],
      [101, false],
      [2.5, false],
    ] as const) {
      draft.quantity = quantity;
      expect(draft.valid, `quantity ${String(quantity)}`).toBe(valid);
    }
  });

  it('leaves the package out once it is cleared, keeping the typed weights', () => {
    const draft = chosen();
    draft.choosePackage('p1');
    draft.choosePackage(undefined);
    expect(draft.body().package_uuid).toBeUndefined();
    expect(draft.fullWeightG).toBe(1193);
  });

  it('drops the package and its weights when another material is chosen', () => {
    const draft = chosen();
    draft.choosePackage('p1');
    draft.choose({ ...detail, uuid: 'm2', packages: [] });
    expect(draft.packageUuid).toBeUndefined();
    expect(draft.fullWeightG).toBeUndefined();
    expect(draft.emptyWeightG).toBeUndefined();
    expect(draft.lengthMM).toBeUndefined();
  });

  it('keeps a typed weight a package does not know', () => {
    const draft = new SpoolDraftForm();
    draft.choose({
      ...detail,
      packages: [
        {
          uuid: 'p2',
          slug: 'refill-750g',
          class: 'FFF',
          material_slug: 'galaxy-black',
          container_slug: '',
          gtin: '',
          container_name: '',
          net_weight_g: 750,
        },
      ],
    });
    draft.fullWeightG = 1000;
    draft.emptyWeightG = 250;
    draft.lengthMM = 100;
    draft.choosePackage('p2');
    expect(draft.fullWeightG).toBe(1000);
    expect(draft.emptyWeightG).toBe(250);
    expect(draft.lengthMM).toBe(100);
  });
});

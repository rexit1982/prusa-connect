// The dashboard screen, driven as a person drives it, over a fake core that
// answers the way the routes do (fixtures.ts).
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
} from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import type { LeaveCheck } from '../../router';
import { expectNoViolations } from '../../test/axe';
import { fakeDevice } from '../../test/fakes';
import DashboardScreen from './dashboard-screen.svelte';
import {
  dashboardContextOver,
  fakeCore,
  type Grant,
  storedDashboard,
} from './fixtures';

const WALL = storedDashboard(4, 'Workshop wall', [
  {
    id: 'n1',
    type: 'core/note',
    x: 0,
    y: 0,
    w: 4,
    h: 2,
    title: 'Shift',
    config: { text: 'Ask before you take a plate' },
  },
  {
    id: 'x1',
    type: 'spools/left',
    x: 4,
    y: 0,
    w: 4,
    h: 2,
    title: '',
    config: {},
  },
]);

const OFFICE = storedDashboard(7, 'Office', []);

const PRINTERS = [
  fakeDevice('mk4', 'MK4 Garage'),
  fakeDevice('mini', 'MINI Desk'),
];

const open = async ({
  dashboards = [WALL, OFFICE],
  grants,
  defaultId = null,
  id,
  kiosk = false,
  edit = false,
  printers = PRINTERS,
}: {
  dashboards?: Parameters<typeof fakeCore>[0];
  grants?: readonly Grant[];
  defaultId?: number | null;
  id?: number;
  kiosk?: boolean;
  edit?: boolean;
  printers?: Parameters<typeof dashboardContextOver>[1];
} = {}) => {
  const { core, client } = fakeCore(dashboards, {
    defaultId,
    ...(grants === undefined ? {} : { grants }),
  });
  const { context, moves } = dashboardContextOver(client, printers);
  const screen = await render(DashboardScreen, {
    props: { context, id, kiosk, edit },
  });

  return { core, context, moves, screen };
};

const pointer = (type: string, x: number): PointerEvent =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    isPrimary: true,
    clientX: x,
    clientY: 10,
  });

/** Where the editor draws one card, the place a drag would land included. */
const drawnAt = (
  context: Awaited<ReturnType<typeof open>>['context'],
  id: string,
): number | undefined => context.editor.cards.find((card) => card.id === id)?.x;

/** Opens the wall to be changed and drags its note half the grid to the right. */
const dragNote = async () => {
  const opened = await open({ id: 4 });
  await userEvent.click(page.getByRole('button', { name: 'Edit' }));
  const grip = document.querySelector(
    '[data-tile="n1"] [data-part="tile-grip"]',
  );
  const grid = document.querySelector('[data-part="board-grid"]');
  if (!(grip instanceof HTMLElement) || !(grid instanceof HTMLElement)) {
    throw new Error('the grid drew no grip');
  }

  grip.dispatchEvent(pointer('pointerdown', 10));
  grid.dispatchEvent(pointer('pointermove', 10 + grid.clientWidth / 2));
  await expect.poll(() => grid.dataset.dragging).toBe('move');
  expect(drawnAt(opened.context, 'n1')).toBe(6);

  return { ...opened, grid };
};

describe('the dashboard screen', () => {
  it('opens the default dashboard on the home page, not the first by name', async () => {
    await open({ defaultId: 7 });

    await expect
      .element(page.getByRole('heading', { level: 1, name: /Office/ }))
      .toBeVisible();
  });

  it('opens the first dashboard by name when none is the default', async () => {
    await open();

    await expect
      .element(page.getByRole('heading', { level: 1, name: /Office/ }))
      .toBeVisible();
  });

  it('draws a dashboard of the fleet when there is none, and stores it on its first Save', async () => {
    const { core, moves } = await open({ dashboards: [] });

    await expect
      .element(page.getByRole('heading', { level: 1, name: /Overview/ }))
      .toBeVisible();

    await userEvent.click(page.getByRole('button', { name: 'Edit' }));
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }));
    expect(core.writes).toEqual([]);

    await userEvent.click(page.getByRole('button', { name: 'Edit' }));
    await userEvent.click(page.getByRole('button', { name: 'Add a card' }));
    await userEvent.click(page.getByRole('button', { name: /Clock/ }));
    await userEvent.click(page.getByRole('button', { name: 'Done' }));
    expect(core.writes).toEqual([]);
    await userEvent.click(page.getByRole('button', { name: 'Save' }));

    await expect.poll(() => core.writes).toEqual(['create']);
    // The page stays where it is, now drawing the stored dashboard.
    expect(moves.opened).toEqual([]);
    expect(core.held.get(1)?.cards.map((card) => card.type)).toEqual(
      expect.arrayContaining(['core/summary', 'core/clock']),
    );
  });

  it('draws each card, a placeholder for a type no module declares, and the note', async () => {
    await open({ id: 4 });

    await expect
      .element(page.getByText('Ask before you take a plate'))
      .toBeVisible();
    await expect
      .element(page.getByText('This card cannot be shown'))
      .toBeVisible();
  });

  it('draws a module card as loading until the listing was read, and reads it on open', async () => {
    let finish = (): void => undefined;
    let asked = 0;
    const loader = {
      activateFor: () => Promise.resolve(),
      discover: () => {
        asked += 1;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      discovered: false,
      unread: false,
    };
    const { client } = fakeCore([WALL]);
    const { context } = dashboardContextOver(client, PRINTERS, loader);
    await render(DashboardScreen, { props: { context, id: 4 } });

    await expect
      .element(page.getByText('Ask before you take a plate'))
      .toBeVisible();
    expect(asked).toBe(1);
    await expect
      .element(page.getByRole('status', { name: 'Loading the card' }))
      .toBeVisible();
    await expect
      .element(page.getByText('This card cannot be shown'))
      .not.toBeInTheDocument();
    finish();
  });

  it('shows only the printers a card of many printers was given', async () => {
    const chosen = storedDashboard(9, 'Garage', [
      {
        id: 'p1',
        type: 'core/printers',
        x: 0,
        y: 0,
        w: 8,
        h: 6,
        title: '',
        config: { devices: ['mk4'] },
      },
    ]);
    await open({ dashboards: [chosen], id: 9 });

    await expect.element(page.getByText('MK4 Garage')).toBeVisible();
    await expect.element(page.getByText('MINI Desk')).not.toBeInTheDocument();
  });

  it('draws the heaters a card of many printers was asked for', async () => {
    const heated = storedDashboard(9, 'Garage', [
      {
        id: 'p1',
        type: 'core/printers',
        x: 0,
        y: 0,
        w: 8,
        h: 6,
        title: '',
        config: { fields: ['state', 'nozzle', 'bed'] },
      },
    ]);
    const mk4 = fakeDevice('mk4', 'MK4 Garage');
    await open({
      dashboards: [heated],
      id: 9,
      printers: [
        {
          ...mk4,
          state: {
            ...mk4.state,
            '/tools/0/nozzle_temp': 215,
            '/temperature/bed': 60,
          },
        },
      ],
    });

    await expect.element(page.getByText('MK4 Garage')).toBeVisible();
    const face = document.querySelector('[data-part="printer-face"]');
    expect(face?.textContent).toContain('215°');
    expect(face?.textContent).toContain('60°');
  });

  // A printer with no chamber gets no box, so its card shows no dash for a
  // reading it never has.
  it('draws the chamber of a printer that has one', async () => {
    const heated = storedDashboard(9, 'Garage', [
      {
        id: 'p1',
        type: 'core/printers',
        x: 0,
        y: 0,
        w: 8,
        h: 6,
        title: '',
        config: { fields: ['state', 'chamber'] },
      },
    ]);
    const core = fakeDevice('core', 'CORE Garage');
    const mk4 = fakeDevice('mk4', 'MK4 Garage');
    await open({
      dashboards: [heated],
      id: 9,
      printers: [
        {
          ...core,
          state: {
            ...core.state,
            '/temperature/chamber': 38,
            '/temperature/chamber_target': 45,
          },
        },
        mk4,
      ],
    });

    await expect.element(page.getByText('CORE Garage')).toBeVisible();
    const faces = [...document.querySelectorAll('[data-part="printer-face"]')];
    const text = (name: string): string =>
      faces.find((face) => face.textContent.includes(name))?.textContent ?? '';
    expect(text('CORE Garage')).toMatch(/38°\s*\/45°/);
    expect(text('MK4 Garage')).not.toContain('Chamber');
  });

  it('offers to add the first printer while the server has none', async () => {
    const { moves } = await open({ printers: [] });

    await expect
      .element(page.getByRole('heading', { name: 'Add your first printer' }))
      .toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Add a printer' }));
    expect(moves.addPrinter).toBe(1);
  });

  it('does not offer the first printer once there is one', async () => {
    await open();

    await expect
      .element(page.getByRole('heading', { level: 1, name: /Office/ }))
      .toBeVisible();
    await expect
      .element(page.getByRole('heading', { name: 'Add your first printer' }))
      .not.toBeInTheDocument();
  });

  it('says a dashboard is gone, and offers the home page', async () => {
    const { moves } = await open({ id: 99 });

    await expect
      .element(
        page.getByRole('heading', { name: 'This dashboard no longer exists' }),
      )
      .toBeVisible();
    await userEvent.click(
      page.getByRole('button', { name: 'Open the home page' }),
    );
    expect(moves.home).toBe(1);
  });

  it('shows a person who may only look no control that changes a dashboard', async () => {
    await open({ id: 4, grants: [] });

    await expect
      .element(page.getByRole('button', { name: 'Share' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Edit' }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: 'More actions' }))
      .not.toBeInTheDocument();
  });

  it('offers the home page only to a person who may configure', async () => {
    const operator = await open({ id: 4, grants: ['operate_resource'] });
    await userEvent.click(page.getByRole('button', { name: 'More actions' }));
    await expect
      .element(page.getByRole('menuitem', { name: 'Make it the home page' }))
      .not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await operator.screen.unmount();

    const { core } = await open({ id: 4 });
    await userEvent.click(page.getByRole('button', { name: 'More actions' }));
    await userEvent.click(
      page.getByRole('menuitem', { name: 'Make it the home page' }),
    );

    await expect.poll(() => core.defaultId).toBe(4);
  });

  it('adds a card from the gallery and saves it', async () => {
    const { core } = await open({ id: 7 });

    await userEvent.click(page.getByRole('button', { name: 'Edit' }));
    await userEvent.click(page.getByRole('button', { name: 'Add a card' }));
    await userEvent.click(page.getByRole('button', { name: /Clock/ }));
    // The settings of the new card open at once, and Done closes them.
    await userEvent.click(page.getByRole('button', { name: 'Done' }));
    await userEvent.click(page.getByRole('button', { name: 'Save' }));

    await expect
      .poll(() => core.held.get(7)?.cards.map((card) => card.type))
      .toEqual(['core/clock']);
    expect(core.held.get(7)?.revision).toBe(2);
  });

  it('removes a card added by mistake from its settings', async () => {
    const { core, context } = await open({ id: 7 });

    await userEvent.click(page.getByRole('button', { name: 'Edit' }));
    await userEvent.click(page.getByRole('button', { name: 'Add a card' }));
    await userEvent.click(page.getByRole('button', { name: /Clock/ }));
    await userEvent.click(page.getByRole('button', { name: 'Remove card' }));

    await expect
      .element(page.getByRole('dialog', { name: 'Clock' }))
      .not.toBeInTheDocument();
    expect(context.editor.cards).toEqual([]);
    expect(core.writes).toEqual([]);
  });

  it('offers to read again a dashboard somebody saved first', async () => {
    const { core } = await open({ id: 7 });

    await userEvent.click(page.getByRole('button', { name: 'Edit' }));
    await userEvent.click(page.getByRole('button', { name: 'Add a card' }));
    await userEvent.click(page.getByRole('button', { name: /Clock/ }));
    await userEvent.click(page.getByRole('button', { name: 'Done' }));
    // A colleague saves first.
    core.held.set(7, { ...OFFICE, name: 'Office, kept', revision: 5 });
    await userEvent.click(page.getByRole('button', { name: 'Save' }));

    await userEvent.click(
      page.getByRole('button', { name: 'Load the saved dashboard' }),
    );
    // The draft is dropped only after the person agrees.
    await userEvent.click(
      page.getByRole('button', { name: 'Drop the changes' }),
    );

    await expect
      .element(page.getByRole('heading', { level: 1, name: /Office, kept/ }))
      .toBeVisible();
  });

  it('asks before a link inside the app drops a draft', async () => {
    const { core, client } = fakeCore([WALL, OFFICE]);
    const { context } = dashboardContextOver(client, PRINTERS);
    let leave: LeaveCheck | undefined;
    let left = 0;
    const go = (): void => {
      left += 1;
    };
    await render(DashboardScreen, {
      props: {
        context: {
          ...context,
          navigation: {
            ...context.navigation,
            checkLeave: (check: LeaveCheck) => {
              leave = check;

              return () => undefined;
            },
          },
        },
        id: 7,
      },
    });

    await userEvent.click(page.getByRole('button', { name: 'Edit' }));
    expect(leave?.(go)).toBe(false);

    await userEvent.click(page.getByRole('button', { name: 'Add a card' }));
    await userEvent.click(page.getByRole('button', { name: /Clock/ }));
    await userEvent.click(page.getByRole('button', { name: 'Done' }));
    expect(leave?.(go)).toBe(true);

    await userEvent.click(
      page.getByRole('button', { name: 'Drop the changes' }),
    );
    expect(left).toBe(1);
    expect(context.editor.editing).toBe(false);
    expect(core.writes).toEqual([]);
  });

  it('makes a dashboard from a template and opens it to be changed', async () => {
    const { core, moves } = await open({ id: 7 });

    await userEvent.click(
      page.getByRole('button', { name: /Dashboards, now Office/ }),
    );
    await userEvent.click(
      page.getByRole('menuitem', { name: 'New dashboard' }),
    );
    await userEvent.fill(
      page.getByRole('textbox', { name: 'Name' }),
      'Night shift',
    );
    await userEvent.click(page.getByRole('button', { name: 'Create' }));

    await expect
      .poll(() => moves.opened)
      .toEqual([{ id: 8, edit: true, replace: false }]);
    expect(core.held.get(8)?.name).toBe('Night shift');
  });

  it('picks a template by a press anywhere on its card', async () => {
    const { core } = await open({ id: 7 });

    await userEvent.click(
      page.getByRole('button', { name: /Dashboards, now Office/ }),
    );
    await userEvent.click(
      page.getByRole('menuitem', { name: 'New dashboard' }),
    );
    await userEvent.fill(page.getByRole('textbox', { name: 'Name' }), 'Bare');
    // The press lands on the drawing, away from the radio and its name.
    const card = page
      .getByText('An empty grid. Add every card yourself.')
      .element()
      .closest('[data-part="template"]');
    if (card === null) throw new Error('the dialog drew no template card');
    await userEvent.click(page.elementLocator(card), {
      position: { x: 20, y: 20 },
    });

    await expect
      .element(page.getByRole('radio', { name: 'Empty' }))
      .toBeChecked();
    await userEvent.click(page.getByRole('button', { name: 'Create' }));
    await expect.poll(() => core.held.get(8)?.cards).toEqual([]);
  });

  it('starts the editor on a dashboard opened to be changed, and keeps no edit in the address', async () => {
    const { moves } = await open({ id: 7, edit: true });

    await expect
      .element(page.getByRole('button', { name: 'Save' }))
      .toBeVisible();
    expect(moves.opened).toEqual([{ id: 7, edit: false, replace: true }]);
  });

  it('opens a dashboard to be changed only to look, for a person who may not change it', async () => {
    await open({ id: 7, edit: true, grants: [] });

    await expect
      .element(page.getByRole('button', { name: 'Share' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Save' }))
      .not.toBeInTheDocument();
  });

  it('draws the wall view, which leaves on Escape', async () => {
    const { moves } = await open({ id: 4, kiosk: true });

    await expect
      .element(page.getByRole('dialog', { name: 'Workshop wall' }))
      .toBeVisible();
    await expect
      .element(page.getByText('Ask before you take a plate'))
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Edit' }))
      .not.toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(moves.kiosk).toEqual([false]);
  });

  it('fills the height of the screen on a wall, whatever the density', async () => {
    const spacious = storedDashboard(4, 'Workshop wall', WALL.cards, {
      density: 'spacious',
    });
    await open({ dashboards: [spacious], id: 4, kiosk: true });
    await expect
      .element(page.getByText('Ask before you take a plate'))
      .toBeVisible();

    const note = document.querySelector('[data-tile="n1"]');
    if (note === null) throw new Error('the wall drew no note');
    // The note spans both of the wall's rows, so it takes most of the window.
    // Spacious rows of a page would make it about a fifth of it.
    expect(note.getBoundingClientRect().height).toBeGreaterThan(
      window.innerHeight / 2,
    );
  });

  it('counts the printers a wall cuts off rather than scrolling them', async () => {
    const fleet = Array.from({ length: 40 }, (_, index) =>
      fakeDevice(`p${String(index)}`, `Printer ${String(index)}`),
    );
    const farm = storedDashboard(5, 'Farm wall', [
      {
        id: 'all',
        type: 'core/printers',
        x: 0,
        y: 0,
        w: 4,
        h: 2,
        title: '',
        config: { size: 'row' },
      },
    ]);
    // A narrow screen stacks the tiles at the height of what they hold.
    await page.viewport(1280, 900);
    onTestFinished(() => page.viewport(414, 896));
    const { client } = fakeCore([farm]);
    const { context } = dashboardContextOver(client, fleet);
    await render(DashboardScreen, { props: { context, id: 5, kiosk: true } });

    const more = page.getByText(/^\+\d+ more$/);
    await expect.element(more).toBeVisible();

    const list = document.querySelector('[data-part="printer-rows"]');
    if (list === null) throw new Error('the card drew no list');
    expect(getComputedStyle(list).overflowY).toBe('hidden');
    const edge = list.getBoundingClientRect().bottom;
    const whole = [...list.children].filter(
      (item) => item.getBoundingClientRect().bottom <= edge + 1,
    ).length;
    await expect
      .element(more)
      .toHaveTextContent(`+${String(fleet.length - whole)} more`);
  });

  it('has no accessibility violations', async () => {
    await open({ id: 4 });
    await expect
      .element(page.getByText('Ask before you take a plate'))
      .toBeVisible();

    const screen = document.querySelector('[data-part="dashboard-screen"]');
    if (screen === null) throw new Error('the screen drew no section');
    await expectNoViolations(screen);
  });
});

describe('a drag on the grid', () => {
  // A narrow screen stacks the tiles, where a drag has no columns.
  beforeEach(async () => {
    await page.viewport(1280, 900);
  });
  afterEach(async () => {
    await page.viewport(414, 896);
  });

  it('drops on Escape while the focus is outside the grid', async () => {
    const { context, grid } = await dragNote();

    await userEvent.keyboard('{Escape}');

    await expect.poll(() => grid.dataset.dragging).toBeUndefined();
    expect(drawnAt(context, 'n1')).toBe(0);
  });

  it('drops when the grip loses the pointer', async () => {
    const { context, grid } = await dragNote();

    // A grip that unmounts loses the capture, and the browser says so on the
    // document.
    document.dispatchEvent(
      new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }),
    );

    await expect.poll(() => grid.dataset.dragging).toBeUndefined();
    expect(drawnAt(context, 'n1')).toBe(0);
  });

  it('keeps the place a released pointer chose', async () => {
    const { context, grid } = await dragNote();

    grid.dispatchEvent(pointer('pointerup', 10 + grid.clientWidth / 2));
    // The browser lets go of the capture after the release.
    document.dispatchEvent(
      new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }),
    );

    await expect.poll(() => grid.dataset.dragging).toBeUndefined();
    expect(drawnAt(context, 'n1')).toBe(6);
    expect(context.editor.canUndo).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Contrast, and nothing else. Every fill somebody reads text on is measured
// against the text drawn on it at WCAG AA's 4.5:1, and every mark a person
// reads without words at WCAG 1.4.11's 3:1. Both sweeps run over both
// themes.
//
// What each token carries is pinned by `tokens.test.ts` beside this file.
// This one reads the declared values and measures them.

const stylesDir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(stylesDir, 'tokens.css'), 'utf8');

/** The text between the braces after a marker, with nested blocks kept. */
const sliceBlock = (marker: string): string => {
  const start = css.indexOf(marker);
  if (start === -1) throw new Error(`marker not found: ${marker}`);
  const open = css.indexOf('{', start);
  if (open === -1) throw new Error(`no block opens after ${marker}`);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after ${marker}`);
};

/**
 * A declaration's value as one line. Prettier wraps a long one over three, and
 * the break leaves a space inside the brackets it broke at.
 */
const collapse = (text: string): string =>
  text.replace(/\s+/g, ' ').replace(/\(\s/g, '(').replace(/\s\)/g, ')').trim();

/** What a block declares a token as, or nothing when it does not declare it. */
const declaredValue = (block: string, token: string): string | null => {
  const match = new RegExp(`^\\s*${token}:\\s*([^;]+);`, 'm').exec(block);
  return match === null ? null : collapse(match[1]!);
};

const declaredTokens = (block: string): string[] =>
  [...block.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((match) => match[1]!);

const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

const tokenBlock = (mode: Theme): string => sliceBlock(`/* @tokens ${mode} */`);

/**
 * The blocks one theme resolves a token through, most specific first: the
 * cascade the browser walks, spelled out. `.dark` sits on the root element
 * with `:root`, scores the same and comes later, so it wins where it declares.
 */
const cascade = (mode: Theme): string[] =>
  mode === 'light'
    ? [tokenBlock('light')]
    : [tokenBlock('dark'), tokenBlock('light')];

// OKLCH to sRGB (CSS Color 4), then WCAG 2.1 relative luminance and contrast.
// Forty lines of arithmetic that will not change, written here rather than
// imported.
type Srgb = readonly [number, number, number];

const encode = (v: number): number => {
  const x = Math.min(1, Math.max(0, v));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};

const oklchToSrgb = (L: number, C: number, hDeg: number): Srgb => {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const bb = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
};

const decode = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

/** A colour the way the theme writes it: lightness 0 to 1, chroma, hue. */
type Oklch = readonly [number, number, number];

// The inverse of the matrices above. The React theme writes a carried-over
// brand value as hex, and a derived token reads a channel off whatever it is
// given, so a hex has to reach the same three channels an oklch() does.
const srgbToOklch = ([r, g, b]: Srgb): Oklch => {
  const lr = decode(r);
  const lg = decode(g);
  const lb = decode(b);
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(B, A) * 180) / Math.PI;
  return [L, Math.hypot(A, B), hue < 0 ? hue + 360 : hue];
};

const luminance = ([r, g, b]: Srgb): number =>
  0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);

/**
 * A resolved colour: its three channels, and how much of what is behind it
 * shows through. The focus ring is the one translucent token this theme has,
 * and a ratio measured without compositing it would be a ratio nobody sees.
 */
interface Colour {
  readonly lch: Oklch;
  readonly alpha: number;
}

const opaque = (lch: Oklch): Colour => ({ lch, alpha: 1 });

const hexChannels = (digits: string): number[] =>
  (digits.match(/../g) ?? []).map((pair) => parseInt(pair, 16) / 255);

// Four notations appear in the theme: oklch() for most of the palette, hex for
// carried-over brand values, rgba() for two translucent steps, and the two
// keywords. Anything else returns null so a caller fails loudly rather than
// measuring a guess.
const parseColour = (value: string): Colour | null => {
  const oklch = /^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/.exec(value);
  if (oklch) {
    return opaque([Number(oklch[1]) / 100, Number(oklch[2]), Number(oklch[3])]);
  }

  const rgba =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
      value,
    );
  if (rgba) {
    const srgb: Srgb = [
      Number(rgba[1]) / 255,
      Number(rgba[2]) / 255,
      Number(rgba[3]) / 255,
    ];
    return { lch: srgbToOklch(srgb), alpha: Number(rgba[4] ?? '1') };
  }

  const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (!hex) return null;
  const digits = hex[1]!;
  // #rgb and #rgba double each digit; #rrggbb and #rrggbbaa are read as they
  // are. Any other length is not a colour.
  const expanded =
    digits.length === 3 || digits.length === 4
      ? (digits.match(/./g) ?? []).map((digit) => digit + digit).join('')
      : digits;
  if (expanded.length !== 6 && expanded.length !== 8) return null;
  const channels = hexChannels(expanded);
  const srgb: Srgb = [channels[0]!, channels[1]!, channels[2]!];
  return { lch: srgbToOklch(srgb), alpha: channels[3] ?? 1 };
};

/** The raw palette, every `--color-*` in block 1 that parses. */
const palette = new Map<string, Colour>();
for (const match of css.matchAll(/(--color-[a-z0-9-]+):\s*([^;]+);/g)) {
  const colour = parseColour(match[2]!.trim());
  if (colour) palette.set(match[1]!, colour);
}

const CHANNELS = { l: 0, c: 1, h: 2 } as const;
type ChannelName = keyof typeof CHANNELS;

/** The channel expressions of a relative colour, parentheses kept whole. */
const splitChannels = (text: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of text) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ' ' && depth === 0) {
      if (current !== '') parts.push(current);
      current = '';
    } else current += character;
  }
  if (current !== '') parts.push(current);
  return parts;
};

/**
 * One channel of a derived colour, against the colour it is read from. The
 * grammar is the one the theme writes and no more: a channel name, a number, a
 * percentage, or a `calc()` that adds to, takes from, or scales one channel.
 */
const channelValue = (expression: string, base: Oklch): number => {
  const name = /^([lch])$/.exec(expression);
  if (name) return base[CHANNELS[name[1] as ChannelName]];

  const percentage = /^([\d.]+)%$/.exec(expression);
  if (percentage) return Number(percentage[1]) / 100;

  if (/^[\d.]+$/.test(expression)) return Number(expression);

  const math = /^calc\(([lch])\s*([+\-*])\s*([\d.]+)\)$/.exec(expression);
  if (!math) throw new Error(`a channel this test cannot read: ${expression}`);
  const from = base[CHANNELS[math[1] as ChannelName]];
  const by = Number(math[3]);
  if (math[2] === '+') return from + by;
  if (math[2] === '-') return from - by;
  return from * by;
};

// Throws rather than defaulting: a token that resolves to nothing would
// otherwise pass every assertion below. Three forms are read: a colour written
// out, another token, and a colour read off one with relative colour syntax.
const resolveToken = (blocks: string[], token: string): Colour => {
  const value = blocks
    .map((block) => declaredValue(block, token))
    .find((hit) => hit !== null);
  if (value === undefined) {
    throw new Error(`${token} is not declared in this theme's cascade`);
  }

  const written = parseColour(value);
  if (written) return written;

  const reference = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (reference) {
    const named = reference[1]!;
    return palette.get(named) ?? resolveToken(blocks, named);
  }

  const derived = /^oklch\(from var\((--[a-z0-9-]+)\) (.+)\)$/.exec(value);
  if (!derived) {
    throw new Error(
      `${token} is \`${value}\`, and a token names a colour or reads one`,
    );
  }
  const from = derived[1]!;
  const base = (palette.get(from) ?? resolveToken(blocks, from)).lch;
  const channels = splitChannels(derived[2]!);
  if (channels.length !== 3) {
    throw new Error(
      `${token} reads ${String(channels.length)} channels, not 3`,
    );
  }
  return opaque([
    channelValue(channels[0]!, base),
    channelValue(channels[1]!, base),
    channelValue(channels[2]!, base),
  ]);
};

/**
 * What a person actually sees. A translucent mark is composited over the
 * surface behind it first, because that is the colour their eye measures.
 */
const ratio = (fg: Colour, bg: Colour): number => {
  const behind = oklchToSrgb(...bg.lch);
  const front = oklchToSrgb(...fg.lch);
  const over = front.map(
    (channel, index) => channel * fg.alpha + behind[index]! * (1 - fg.alpha),
  ) as unknown as Srgb;
  const a = luminance(over);
  const b = luminance(behind);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

// Every fill a person reads text on. Each one owns a foreground token of its
// own, and a component pairs the two and never borrows another surface's.
// `SURFACES` is the list that rule is held against: a fill added here with no
// `--<name>-foreground` beside it fails the test below rather than shipping
// with the page's foreground on it by accident.
// The page's own text is `--foreground` and not `--background-foreground`,
// because it is the colour every other token falls back to. Every other
// surface names its foreground after itself.
// `--disabled` is not here: WCAG exempts an inactive control from the text
// bar, and the theme spends the pair on a fill a person can still see rather
// than on a ratio.
const SURFACES: [string, string][] = [
  ['--background', '--foreground'],
  ['--card', '--card-foreground'],
  ['--card-raised', '--card-foreground'],
  ['--popover', '--popover-foreground'],
  ['--primary', '--primary-foreground'],
  ['--secondary', '--secondary-foreground'],
  ['--muted', '--muted-foreground'],
  ['--destructive', '--destructive-foreground'],
  ['--success', '--success-foreground'],
  ['--warning', '--warning-foreground'],
  ['--info', '--info-foreground'],
];

/**
 * The pairs the names imply, read out of the light block. `--x-foreground`
 * sits on `--x` and on its hovered and pressed fills; `--x-text` sits on the
 * page, a card and a popover; a state's text sits on its own fill; the muted
 * foreground sits on every quiet surface.
 */
const textPairs = (): [string, string][] => {
  const tokens = new Set(declaredTokens(tokenBlock('light')));
  // The three surfaces a word of status is written on. Not the raised tone,
  // which is a fill no surface pairs a `-text` token with.
  const PAGES = ['--background', '--card', '--popover'];
  const pairs: [string, string][] = [
    ['--foreground', '--background'],
    // A card inside a card keeps the card's text, on the raised fill.
    ['--card-foreground', '--card-raised'],
    // A panel that sets a fill and no colour inherits the page's text, so the
    // page's foreground is measured on each of them too.
    ['--foreground', '--surface'],
    ['--foreground', '--accent'],
    ['--foreground', '--muted'],
    // The quiet line, wherever a screen puts one.
    ['--muted-foreground', '--background'],
    ['--muted-foreground', '--card'],
    ['--muted-foreground', '--card-raised'],
    ['--muted-foreground', '--popover'],
    ['--muted-foreground', '--surface'],
    ['--muted-foreground', '--accent'],
    // Link text, on every surface a link is written on.
    ['--link', '--background'],
    ['--link', '--card'],
    ['--link', '--popover'],
  ];
  for (const token of tokens) {
    if (token === '--disabled-foreground') continue;
    const foreground = /^--(.+)-foreground$/.exec(token);
    if (foreground) {
      const fill = `--${foreground[1]!}`;
      for (const suffix of ['', '-hovered', '-pressed']) {
        if (tokens.has(fill + suffix)) pairs.push([token, fill + suffix]);
      }
    }
    const state = /^(--state-[a-z]+)-text$/.exec(token);
    if (state) pairs.push([token, state[1]!]);
    else if (token.endsWith('-text')) {
      // good, warning, critical and info written as words.
      for (const bg of PAGES) pairs.push([token, bg]);
    }
  }
  return pairs;
};

/**
 * The pairs WCAG 1.4.11 measures at 3:1 rather than 4.5:1, because nobody
 * reads words in them: the edge of a text control, the focus ring against the
 * surface it is offset from, and the filled part of a progress bar against its
 * track.
 *
 * A primary button's own edge is not measured against its fill but against the
 * page, and the edge is `border-primary` rather than the fill (see
 * primitives/button/variants.ts), so the `--ring` rows below are that
 * measurement: both tokens are `--primary`. That is what lets a pale fill keep
 * a button whose shape a person can still find.
 *
 * A chart's threshold line is `--muted-foreground`, which the text pairs above
 * already hold to 4.5:1 on every surface, so it has no row here.
 */
const NON_TEXT_PAIRS: [string, string][] = [
  ['--input', '--background'],
  ['--input', '--card'],
  ['--input', '--popover'],
  ['--ring', '--background'],
  ['--ring', '--card'],
  ['--ring', '--muted'],
  // primitives/progress draws the track in --muted and the filled part in
  // --primary.
  ['--primary', '--muted'],
  // primitives/line-chart's series palette. The primitive fixes no
  // background of its own, so each token is measured against every surface
  // a chart might be dropped onto.
  ['--primary', '--background'],
  ['--primary', '--card'],
  ['--primary', '--popover'],
  ['--info', '--background'],
  ['--info', '--card'],
  ['--info', '--popover'],
  ['--success-text', '--background'],
  ['--success-text', '--card'],
  ['--success-text', '--popover'],
  ['--warning-text', '--background'],
  ['--warning-text', '--card'],
  ['--warning-text', '--popover'],
  ['--destructive-text', '--background'],
  ['--destructive-text', '--card'],
  ['--destructive-text', '--popover'],
];

describe('text clears WCAG AA in both themes', () => {
  const pairs = textPairs();

  it('has a palette and pairs to measure', () => {
    // An empty palette or an empty pair list would make every assertion below
    // pass vacuously.
    expect(palette.size).toBeGreaterThan(80);
    expect(pairs.length).toBeGreaterThan(30);
  });

  for (const mode of THEMES) {
    describe(mode, () => {
      for (const [fg, bg] of pairs) {
        it(`${fg} on ${bg}`, () => {
          const blocks = cascade(mode);
          const measured = Number(
            ratio(resolveToken(blocks, fg), resolveToken(blocks, bg)).toFixed(
              2,
            ),
          );
          expect(
            measured,
            `${fg} on ${bg} in the ${mode} theme`,
          ).toBeGreaterThanOrEqual(4.5);
        });
      }
    });
  }
});

// WCAG 1.4.11: a border, a ring or a filled bar carries no words, so 3:1 is
// the bar rather than 4.5:1. Under it a person cannot tell where a text box
// ends, which part of a progress bar is filled, or what has focus.
describe('non-text marks clear WCAG 1.4.11 in both themes', () => {
  for (const mode of THEMES) {
    describe(mode, () => {
      for (const [mark, against] of NON_TEXT_PAIRS) {
        it(`${mark} on ${against}`, () => {
          const blocks = cascade(mode);
          const measured = Number(
            ratio(
              resolveToken(blocks, mark),
              resolveToken(blocks, against),
            ).toFixed(2),
          );
          expect(
            measured,
            `${mark} on ${against} in the ${mode} theme`,
          ).toBeGreaterThanOrEqual(3);
        });
      }
    });
  }
});

describe('every surface owns the foreground drawn on it', () => {
  const light = new Set(declaredTokens(tokenBlock('light')));

  it.each(SURFACES)('%s carries %s', (surface, foreground) => {
    expect(light.has(surface)).toBe(true);
    expect(light.has(foreground)).toBe(true);
  });

  // Every pair above is measured by the sweeps. This is the line that says the
  // sweep saw them: a surface dropped from the generator would pass every
  // assertion in this file and ship unmeasured.
  const measured = new Set(textPairs().map(([fg, bg]) => `${fg} ${bg}`));

  it.each(SURFACES)('%s under %s is measured', (surface, foreground) => {
    expect(measured.has(`${foreground} ${surface}`)).toBe(true);
  });
});

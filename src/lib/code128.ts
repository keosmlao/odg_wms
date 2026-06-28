/**
 * Minimal Code 128-B encoder → bar geometry for SVG rendering.
 * No external dependency. Code set B (printable ASCII 32..126), which covers the
 * warehouse codes used here (e.g. "SP0001", "120112-Z01").
 *
 * Algorithm: Start-B (104) · data values (ascii−32) · checksum (mod 103) · Stop.
 * Each symbol is a 6-module pattern of alternating bar/space widths (the Stop
 * symbol has 7 modules incl. the terminating bar).
 */
const PATTERNS: string[] = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
];
const START_B = 104;
const STOP = 106;

export type Bar = { x: number; w: number };

/** Returns the black-bar rectangles (in module units) plus the total module width. */
export function code128B(text: string): { bars: Bar[]; width: number } {
  const codes: number[] = [START_B];
  for (const ch of text) {
    const v = ch.charCodeAt(0) - 32;
    if (v >= 0 && v <= 94) codes.push(v); // Code-B range; silently drop others
  }
  let sum = START_B;
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103);
  codes.push(STOP);

  const bars: Bar[] = [];
  let x = 0;
  for (const c of codes) {
    const pat = PATTERNS[c];
    for (let i = 0; i < pat.length; i++) {
      const w = pat.charCodeAt(i) - 48;
      if (i % 2 === 0) bars.push({ x, w }); // even index = bar, odd = space
      x += w;
    }
  }
  return { bars, width: x };
}

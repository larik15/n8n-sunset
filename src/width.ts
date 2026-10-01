const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

// East Asian Wide and Fullwidth ranges (Hangul Jamo, CJK, Hangul syllables, fullwidth forms, ...).
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]/u;
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}​-‍︀-️]+$/u;

function graphemeWidth(grapheme: string): number {
  if (ZERO_WIDTH.test(grapheme)) return 0;
  return EMOJI.test(grapheme) || WIDE.test(grapheme) ? 2 : 1;
}

export function graphemes(text: string): string[] {
  return [...segmenter.segment(text)].map((s) => s.segment);
}

/** Columns a string takes in a terminal: emoji and CJK take two, combining marks none. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const g of graphemes(text)) width += graphemeWidth(g);
  return width;
}

export function padEnd(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

/** Greedy word wrap by display width; words wider than the width are split between graphemes. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  let lineWidth = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const wordWidth = displayWidth(word);
    if (wordWidth > width) {
      if (line) lines.push(line);
      line = '';
      lineWidth = 0;
      for (const g of graphemes(word)) {
        const w = graphemeWidth(g);
        if (lineWidth + w > width && line) {
          lines.push(line);
          line = '';
          lineWidth = 0;
        }
        line += g;
        lineWidth += w;
      }
    } else if (!line) {
      line = word;
      lineWidth = wordWidth;
    } else if (lineWidth + 1 + wordWidth <= width) {
      line += ` ${word}`;
      lineWidth += 1 + wordWidth;
    } else {
      lines.push(line);
      line = word;
      lineWidth = wordWidth;
    }
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

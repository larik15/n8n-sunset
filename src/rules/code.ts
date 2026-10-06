/**
 * Comments in Code node source, removed before model IDs are looked for, so that `// was 'gemini-2.0-flash'`
 * does not keep a migrated workflow failing. A small scanner that knows string literals is enough here: it never
 * removes text inside quotes, and it keeps the line structure.
 */
export type CodeLanguage = 'javascript' | 'python';

/** n8n stores Python in `pythonCode` (Code node) and everything else as JavaScript. */
export function codeLanguage(key: string): CodeLanguage {
  return key === 'pythonCode' ? 'python' : 'javascript';
}

export function stripComments(source: string, language: CodeLanguage): string {
  return language === 'python' ? stripPython(source) : stripJavaScript(source);
}

function stripJavaScript(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const end = endOfString(src, i, c);
      out += src.slice(i, end);
      i = end;
    } else if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function stripPython(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i);
      const end = triple ? src.indexOf(c.repeat(3), i + 3) : endOfString(src, i, c);
      const stop = triple ? (end < 0 ? src.length : end + 3) : end;
      out += src.slice(i, stop);
      i = stop;
    } else if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Index just past the closing quote of the string that starts at `start` (backslash escapes respected). */
function endOfString(src: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') i += 2;
    else if (c === quote) return i + 1;
    else if (c === '\n' && quote !== '`') return i; // an unterminated '...' or "..." ends at the line
    else i++;
  }
  return src.length;
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cssCustomProperties } from './tokens';

const css = readFileSync(fileURLToPath(new URL('../tokens.css', import.meta.url)), 'utf8');

function parseDeclarations(source: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const match of source.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;{}]+);/g)) {
    declarations.set(match[1]!, match[2]!.trim());
  }
  return declarations;
}

describe('tokens.css (the web mirror of the token layer)', () => {
  it('declares exactly the theme custom properties, value for value', () => {
    const declared = parseDeclarations(css);
    expect(declared.size).toBe(Object.keys(cssCustomProperties).length);
    for (const [name, hex] of Object.entries(cssCustomProperties)) {
      const inCss = declared.get(name);
      expect(inCss, `${name} missing from tokens.css`).toBeDefined();
      expect((inCss ?? '').toLowerCase()).toBe(hex.toLowerCase());
    }
  });

  it('declares them on :root so every screen inherits the palette', () => {
    expect(css).toMatch(/:root\s*\{/);
  });
});

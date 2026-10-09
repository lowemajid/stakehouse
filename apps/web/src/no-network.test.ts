import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fontFamilies, fontStacks } from '@stakehouse/theme';

const thisDir = path.dirname(fileURLToPath(import.meta.url)); // apps/web/src
const webDir = path.resolve(thisDir, '..'); // apps/web
const repoDir = path.resolve(webDir, '../..'); // repo root

function walkCss(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkCss(full));
    else if (entry.name.endsWith('.css')) found.push(full);
  }
  return found;
}

const cssFiles = [
  ...walkCss(path.join(webDir, 'src')),
  path.join(repoDir, 'packages', 'theme', 'tokens.css'),
];
const htmlShell = path.join(webDir, 'index.html');
const fontsCss = path.join(webDir, 'src', 'styles', 'fonts.css');

describe('zero external network requests', () => {
  it('keeps external URLs out of every stylesheet and the HTML shell', () => {
    for (const file of [...cssFiles, htmlShell]) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} references fonts.googleapis.com`).not.toContain(
        'fonts.googleapis.com',
      );
      expect(source, `${file} references fonts.gstatic.com`).not.toContain('fonts.gstatic.com');
      expect(source, `${file} contains an absolute external URL`).not.toMatch(/https?:\/\//);
      for (const match of source.matchAll(/@import\s+['"]?([^'";)]+)/g)) {
        expect(
          match[1]!.trim().startsWith('.'),
          `${file} @imports '${match[1]!.trim()}' — only relative imports are allowed`,
        ).toBe(true);
      }
    }
  });

  it('resolves every url() to a bundled asset on disk', () => {
    for (const file of cssFiles) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/url\(\s*['"]?([^'")]+?)['"]?\s*\)/g)) {
        const ref = match[1]!.trim();
        expect(ref.startsWith('/'), `${file} url('${ref}') must be an absolute-local path`).toBe(
          true,
        );
        const onDisk = path.join(webDir, 'public', ref.slice(1));
        expect(existsSync(onDisk), `${file} url('${ref}') — file missing from public/`).toBe(true);
      }
    }
  });

  it('self-hosts every theme font family with @font-face', () => {
    const source = readFileSync(fontsCss, 'utf8');
    for (const family of Object.values(fontFamilies)) {
      expect(source, `${family} has no @font-face`).toContain(`font-family: '${family}'`);
    }
  });

  it('mirrors the theme font stacks as CSS variables', () => {
    const source = readFileSync(fontsCss, 'utf8');
    const squeeze = (value: string) => value.replace(/\s+/g, ' ').trim();
    for (const [role, stack] of Object.entries(fontStacks)) {
      const match = source.match(new RegExp(`--sh-font-${role}\\s*:\\s*([^;]+);`));
      expect(match, `--sh-font-${role} missing from fonts.css`).not.toBeNull();
      expect(squeeze(match?.[1] ?? '')).toBe(squeeze(stack));
    }
  });
});

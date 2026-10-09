import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface ThemePackage {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const srcDir = `${pkgDir}/src`;
const pkg = JSON.parse(readFileSync(`${pkgDir}/package.json`, 'utf8')) as ThemePackage;

describe('packages/theme standalone contract', () => {
  it('carries no dependencies — the React Native twin installs nothing extra', () => {
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.devDependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });

  it('imports nothing outside the package', () => {
    const sources = readdirSync(srcDir).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const code = readFileSync(`${srcDir}/${file}`, 'utf8');
      const specifiers = [...code.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1]!);
      for (const specifier of specifiers) {
        expect(
          specifier.startsWith('.'),
          `${file} imports '${specifier}' — theme must stay dependency-free`,
        ).toBe(true);
      }
    }
  });
});

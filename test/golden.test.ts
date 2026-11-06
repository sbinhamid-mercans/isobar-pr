import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { toJson } from '../src/report/json.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { runFixture, type Fixture } from './helpers/makeGraph.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'fixtures');
/** Every subdirectory of test/fixtures is a golden case, except sample projects (a directory with a package.json, e.g. project-tiny). */
const cases = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !existsSync(join(root, d.name, 'package.json')))
  .map((d) => d.name)
  .sort();

describe('golden fixtures', () => {
  for (const name of cases) {
    test(name, async () => {
      expect(existsSync(join(root, name, 'fixture.ts')), `${name}: missing fixture.ts`).toBe(true);
      const fixture = (await import(`./fixtures/${name}/fixture.ts`)).default as Fixture;
      const report = runFixture(fixture);
      const md = renderMarkdown(report);
      const json = toJson(report);
      const mdPath = join(root, name, 'expected.md');
      const jsonPath = join(root, name, 'expected.json');
      if (process.env['UPDATE_GOLDEN'] === '1') {
        writeFileSync(mdPath, md);
        writeFileSync(jsonPath, json);
      }
      for (const p of [mdPath, jsonPath]) expect(existsSync(p), `missing ${p}: run UPDATE_GOLDEN=1 npx vitest run test/golden.test.ts`).toBe(true);
      expect(md).toBe(readFileSync(mdPath, 'utf8'));
      expect(json).toBe(readFileSync(jsonPath, 'utf8'));
    });
  }
});

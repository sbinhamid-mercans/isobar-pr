import type { RefactorIssue } from '../../../src/graph/types.js';
import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

/**
 * isobar keeps one complexity issue per function and relabels it: `paths` (cyclomatic over) becomes `logic` once
 * cognitive is over too, and back again when cognitive drops. The relabel alone is no change (found on arbites and EQ,
 * Task 25): `errors.ts` crossed cognitive while staying over cyclomatic, so it is a regression and not also
 * "Many paths … resolved"; `client.ts` left cognitive while staying over cyclomatic, so it is an improvement and not
 * also an issue-only "Many paths" regression.
 */
const crossedCognitive = 'src/api/errors.ts';
const leftCognitive = 'src/api/client.ts';

const paths: RefactorIssue = {
  kind: 'paths',
  severity: 'low',
  title: 'Many paths through one function',
  how: 'Move groups of checks into helpers (or a validation schema), so each function has a few paths.',
};
const logic: RefactorIssue = {
  kind: 'logic',
  severity: 'high',
  title: 'Too much logic in one function',
  how: 'Split it into steps: give each block that does one job its own well-named function.',
};

const fixture: Fixture = {
  base: makeGraph({
    files: {
      [crossedCognitive]: {
        kind: 'service',
        complexity: { cognitive: 15 },
        functions: [fn('showErrorToast', { line: 466, end_line: 522, cognitive: 15, cyclomatic: 22, nesting: 1, lines: 57, params: 2, over: ['cyclomatic'], time: 'O(n)', refactor: [paths] })],
      },
      [leftCognitive]: {
        kind: 'service',
        complexity: { cognitive: 18 },
        functions: [fn('runRequest', { line: 339, end_line: 420, cognitive: 18, cyclomatic: 25, nesting: 3, lines: 82, params: 3, over: ['cognitive', 'cyclomatic'], time: 'O(n)', refactor: [logic] })],
      },
    },
  }),
  head: makeGraph({
    git_sha: 'h000000',
    files: {
      [crossedCognitive]: {
        kind: 'service',
        complexity: { cognitive: 18 },
        functions: [
          fn('showErrorToast', { line: 544, end_line: 606, cognitive: 18, cyclomatic: 25, nesting: 1, lines: 63, params: 2, over: ['cognitive', 'cyclomatic'], time: 'O(n)', refactor: [logic] }),
        ],
      },
      [leftCognitive]: {
        kind: 'service',
        complexity: { cognitive: 12 },
        functions: [fn('runRequest', { line: 339, end_line: 410, cognitive: 12, cyclomatic: 22, nesting: 2, lines: 72, params: 3, over: ['cyclomatic'], time: 'O(n)', refactor: [paths] })],
      },
    },
  }),
  changes: changes([crossedCognitive, leftCognitive], { hunks: { [crossedCognitive]: [[560, 575]], [leftCognitive]: [[350, 360]] } }),
};

export default fixture;

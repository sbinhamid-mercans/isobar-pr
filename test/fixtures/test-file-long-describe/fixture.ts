import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

/** A describe callback that grew past the lines limit only: long by nature in a test file, so no finding (A35 #4). */
const linesOnly = 'src/lib/alpha.test.ts';
/** The same growth plus a cognitive crossing: reported, with `lines` left out of the title. */
const alsoCognitive = 'src/lib/beta.test.ts';

const fixture: Fixture = {
  base: makeGraph({
    files: {
      [linesOnly]: {
        kind: 'test',
        complexity: { cognitive: 4 },
        functions: [fn('describe callback', { line: 10, end_line: 104, cognitive: 4, cyclomatic: 1, nesting: 1, lines: 95, params: 0, time: 'O(1)' })],
      },
      [alsoCognitive]: {
        kind: 'test',
        complexity: { cognitive: 9 },
        functions: [fn('describe callback', { line: 12, end_line: 106, cognitive: 9, cyclomatic: 4, nesting: 2, lines: 95, params: 0, time: 'O(n)' })],
      },
    },
  }),
  head: makeGraph({
    git_sha: 'h000000',
    files: {
      [linesOnly]: {
        kind: 'test',
        complexity: { cognitive: 4 },
        functions: [fn('describe callback', { line: 10, end_line: 139, cognitive: 4, cyclomatic: 1, nesting: 1, lines: 130, params: 0, over: ['lines'], time: 'O(1)' })],
      },
      [alsoCognitive]: {
        kind: 'test',
        complexity: { cognitive: 18 },
        functions: [
          fn('describe callback', { line: 12, end_line: 151, cognitive: 18, cyclomatic: 8, nesting: 3, lines: 140, params: 0, over: ['cognitive', 'lines'], time: 'O(n)' }),
        ],
      },
    },
  }),
  changes: changes([linesOnly, alsoCognitive], { hunks: { [linesOnly]: [[100, 134]], [alsoCognitive]: [[90, 134]] } }),
};

export default fixture;

import { changes, fn, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const inbox = 'src/pages/manager-inbox/ManagerInbox.tsx';
const view = 'src/components/inbox/MessageView.tsx';
const quiet = 'src/utils/format.ts';

const files = {
  [inbox]: { kind: 'page', complexity: { cognitive: 52 }, imported_by: ['src/App.tsx'], functions: [fn('ManagerInbox', { line: 1, end_line: 400, cognitive: 52, lines: 400, over: ['cognitive', 'lines'] })] },
  [view]: { kind: 'component', complexity: { cognitive: 13 }, imported_by: ['test/MessageView.test.tsx', inbox], functions: [fn('MessageView', { line: 1, end_line: 60, cognitive: 13 })] },
  [quiet]: { kind: 'util', complexity: { cognitive: 2 }, functions: [fn('format', { line: 1, end_line: 8, cognitive: 2 })] },
  'test/MessageView.test.tsx': { kind: 'test' },
  'src/App.tsx': { kind: 'router' },
};

// Hotspots come from the BASE graph only: isobar anchors its churn window to each side's latest commit,
// so head ranks drift with every push. The head list here is deliberately different and must be ignored.
const fixture: Fixture = {
  base: makeGraph({
    files,
    hotspots: [
      { rank: 1, file: inbox, score: 0.583, commits: 49, authors: 2, cognitive: 52 },
      { rank: 2, file: view, score: 0.423, commits: 61, authors: 2, cognitive: 13 },
    ],
  }),
  head: makeGraph({
    git_sha: 'h000000',
    files,
    hotspots: [{ rank: 1, file: quiet, score: 0.9, commits: 3, cognitive: 2 }],
  }),
  changes: changes([inbox, view, quiet], { hunks: { [inbox]: [[300, 320]], [view]: [[10, 12]], [quiet]: [[1, 2]] } }),
};

export default fixture;

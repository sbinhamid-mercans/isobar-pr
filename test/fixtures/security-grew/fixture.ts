import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const repo = 'src/main/java/com/eq/frip/repository/inbox/InboxScopeRepositoryImpl.java';
const files = { [repo]: { kind: 'model' } };
const text = 'SQL is built by inserting values into the query text, which allows SQL injection. Pass the values as query parameters instead.';

const fixture: Fixture = {
  base: makeGraph({ files, security: { warnings: [{ level: 'serious', text, file: repo, line: 232, lines: [232, 403], code: 'em.createNativeQuery("… " + where)' }] } }),
  head: makeGraph({
    git_sha: 'h000000',
    files,
    security: { warnings: [{ level: 'serious', text, file: repo, line: 232, lines: [232, 403, 450], code: 'em.createNativeQuery("… " + where)' }] },
  }),
  changes: changes([repo], { hunks: { [repo]: [[448, 452]] } }),
};

export default fixture;

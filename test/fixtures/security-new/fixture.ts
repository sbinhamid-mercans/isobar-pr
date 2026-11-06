import { changes, makeGraph, type Fixture } from '../../helpers/makeGraph.js';

const repo = 'src/main/java/com/eq/frip/repository/inbox/EscalationScopeRepositoryImpl.java';
const token = 'src/lib/auth.ts';
const files = { [repo]: { kind: 'model' }, [token]: { kind: 'util' } };

const fixture: Fixture = {
  base: makeGraph({ files, security: { warnings: [] } }),
  head: makeGraph({
    git_sha: 'h000000',
    files,
    security: {
      warnings: [
        {
          level: 'serious',
          text: 'SQL is built by inserting values into the query text, which allows SQL injection. Pass the values as query parameters instead.',
          file: repo,
          line: 32,
          lines: [32, 53],
          code: 'Query countQuery = entityManager.createNativeQuery("SELECT COUNT(DISTINCT et.id) " + from);',
        },
        {
          level: 'advisory',
          text: 'An auth token is stored in localStorage, where any script on the page can read it (XSS). An httpOnly cookie can’t be read by scripts.',
          file: token,
          line: 8,
          lines: [8],
          code: "localStorage.setItem('token', jwt)",
        },
      ],
    },
  }),
  changes: changes([repo, token], { hunks: { [repo]: [[30, 35]], [token]: [[20, 25]] } }),
};

export default fixture;

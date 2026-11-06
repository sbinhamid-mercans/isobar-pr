# isobar-pr Demo Repo and Release Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `sbinhamid-mercans/isobar-pr` publicly (tag `v1`, optional npm) and `sbinhamid-mercans/isobar-pr-demo`, a self-contained Express + React fixture app with seeded history whose `demo/regression` PR shows all six report sections and a red check, for the ~2-minute hackathon video.

**Architecture:** The demo app is one git project (root `package.json`, `server/` + `client/` + `shared/`) sized so isobar 0.7.1 mines the conventions the PR breaks (≥ 5 files per kind, ≥ 8 hook→service imports). `scripts/seed-history.sh` rebuilds 34 backdated commits from the working tree so `server/services/invoiceService.ts` is the #1 hotspot. `scripts/check-graph.mjs` runs isobar and asserts the invariants on `main` and on the regression branch, so the fixture is self-checking. Release is a fixed command sequence, owner-gated.

**Tech Stack:** TypeScript 5.9 (`moduleResolution: Bundler`, `jsx: react-jsx`, `noEmit`), Express 5, pg, React 19, vitest 3; isobar 0.7.1 via `npx -y`; isobar-pr `dist/cli.js` from `~/Projects/isobar-pr`; `gh` CLI (logged in as `sbinhamid-mercans`, `repo` scope).

**Standing rules for every subagent:** never `git commit`/`git push` in `~/Projects/isobar-pr` (the owner commits). In `~/Projects/isobar-pr-demo` the seeded commits and the branch commits ARE the fixture: create them exactly as the tasks say, never push. Never add a `Co-Authored-By` trailer. Never touch `~/Projects/Command-Center/*`. A PreToolUse hook blocks the first Bash per working directory and the first Write of a new file until numbered fact lines appear as plain text right before the call: Bash needs `1. The current user request: …` and `2. This command verifies/produces: …`; a new-file Write needs four lines (which files reference it; no existing file serves the purpose; data fields or "none"; the user's instruction verbatim). A command whose text contains `rm -rf` is gated separately (three lines: files modified/deleted, one-line rollback, the user's instruction verbatim); prefer the Write tool for files that quote such commands. Repeat verbatim and retry if blocked. Do not paste isobar's security warning texts into reports; say "the SQL warning".

---

## Facts about isobar 0.7.1 the design depends on

Measured on 2026-11-05 from the bundle in the npx cache (`~/.npm/_npx/*/node_modules/isobar/dist/isobar.js`) and verified on a scratch project. Keep the `isobar@0.7.1` pin (0.7.2 exists; the owner wants the parent untouched).

- **Kinds (first match wins):** `.test.`/`.spec.` or a `test|tests|__tests__|spec|e2e` dir → test; `*.config.*` → config; `/hooks?/` dir or stem `^use[A-Z]` → hook; `/routes?/` dir → route (page if it has JSX); `/components?/` dir with JSX → component; `/pages/` dir with JSX → page; `models?|db|database|repositor(y|ies)` dir → model; `services?|api|clients?` dir or stem ending `service|api|client` → service; stem `types` → types; `utils?|lib|helpers?|shared|common|core` dir → util; otherwise component if JSX else module. There is no `repository` kind. `index` stems are excluded from `name:`/`suffix:` samples. Entry = root `index.html` with `<script src>`, else `package.json` scripts/main only when there is no react dep, else `src/main|src/index|server|app|main|index` resolved through `name/index.*` (so `server/index.ts` is the entry of a React project with no root index.html).
- **Conventions:** strength rule ≥ 90 % followers, mostly ≥ 75 %, else dropped. `name:<kind>` and `exports:<kind>` need ≥ 5 non-index files of the kind; `exports:` is named-vs-default and `export default router` counts as default. `name:hook-prefix` checks the FILENAME stem for `use[A-Z]`. `suffix:<dir>` needs ≥ 5 files in one exact directory sharing a trailing `[A-Z][a-z0-9]+` suffix (`Service`, `Api`). `layer:A>B` counts file-pair import edges between different kinds; needs dominant direction ≥ 5 and total ≥ 8; exceptions are the importer files on the reverse side; a service importing a hook is an exception only if `layer:hook>service` exists. `tests:place` needs ≥ 5 test files; "beside" = a non-test file with the same stem in the same dir. `pkg:<pkg>` needs ≥ 4 user files AND the top folder bucket (first path segment) must hold ≥ 90 % of users while being < 50 % of all source files (react excluded). `http:wrappers` needs ≥ 5 calls and ≥ 75 % through a wrapper, so all-plain-`fetch` yields no pattern. `barrel:` needs an index file + ≥ 4 files + ≥ 10 outside imports; `imports:alias` needs ≥ 20 cross-folder imports. `example` = follower with fewest flagged functions, then LOC closest to median.
- **Security (JS/TS):** `.query(`/`.execute(`/`.raw(`/`$queryRawUnsafe(` whose first argument is a template literal containing SELECT|INSERT|UPDATE|DELETE and a `${expr}` (expr not CONSTANT_CASE, not a literal), or a quoted SQL string immediately followed by `+ expr`, gives a **serious** warning when the SQL text has no `$1`/`?`/`:name`/`%s` placeholder (advisory when it has one). `pool.query('… WHERE id = $1', [id])` emits nothing. A connection string literal with a password and a non-local host is serious: use `process.env.DATABASE_URL` only. Dedupe is by file + text; a second occurrence in the same file appends to `lines[]`. Tests, config and types files are skipped.
- **HTTP:** Express routes from `<app|router|…>.(get|post|put|patch|delete|all|use)('<literal>'…)`; `.use('/p', x)` mounts compose prefixes through the import binding of `x` (verified `app.use('/api/orders', ordersRouter)` + `router.get('/search')` → `GET /api/orders/search`). Client calls from `fetch`/axios/ky/got and wrappers; `${x}` segments become `:param`; a `:param` on EITHER side matches any segment, so a base route `GET /api/orders/:id` would match the planted `/api/orders/export`: **no 3-segment `GET /api/orders/:id` route** (use `/api/orders/:id/items`, 4 segments). Segment counts must match unless the route ends in `*`. A call with no `target`, not `external`, not `dynamic` is "no matching route". Matching works within one repo (server/ + client/).
- **Time / refactor:** a `find|filter|some|every|includes|indexOf` on a parameter-rooted array inside a `for`/`for-of`/`forEach`/`map` over another array → `scan-in-loop` (high), time `O(n·m)` (one loop) or `O(n·m·k)` (two). The receiver must not be a loop-local. ≥ 4 `else if` → `chain` (medium). Nested functions and callbacks are measured separately (`outer › find callback`) and do not add to the parent.
- **Hotspots:** `git log --no-merges -M --numstat --since=<HEAD time − 12 months>`; commits counted per file, renames followed; `score = (fileCognitive / maxCognitive) × (commits / maxCommits)`, file cognitive = sum over all functions incl. top level; top 10 ranked; tests and config excluded; a shallow clone makes every file 1 commit (CI needs `fetch-depth: 0`). "imported by N tests" = direct importers of kind test.
- **Limits (hard-coded, no config):** cognitive 15, cyclomatic 10, nesting 4, lines 100, params 5, strictly greater is "over". A function is listed in `files[].functions` only if cyclomatic > 1, cognitive > 0, nesting > 1, lines ≥ 25, params > 5, a refactor issue, or super-linear time: a simplified function must keep ≥ 1 branch to show as "improved" instead of vanishing.
- **Project detection:** root `package.json` or `.git` → ONE project, `server/` and `client/` both parsed and linked. Ignored: node_modules, dist, build, coverage, **public**, every dot-dir, `*.d.ts`, `.gitignore`d files. Parsed: .ts .tsx .js .jsx .mjs .cjs .mts .cts.
- **Cycles:** Tarjan SCC over value imports; type-only imports excluded.

---

## File structure of `~/Projects/isobar-pr-demo` (final `main` tree: 45 files isobar parses, plus 2 scripts, 2 workflows and 5 root files)

```
package.json  package-lock.json  tsconfig.json  .gitignore  README.md
.github/workflows/isobar-pr.yml      the six-line consumer workflow, fail-on: serious-security
.github/workflows/ci.yml             npm ci, typecheck, test
scripts/seed-history.sh              rebuilds git history (34 commits) from the working tree
scripts/check-graph.mjs              runs isobar, asserts the fixture invariants (main | regression)
shared/types.ts                      Order, OrderLine, Customer, Product, Invoice, Shipment, Zone, summaries   (kind types)
shared/lib/{money,dates,pagination,validation,ids}.ts                                                       (kind util ×5)
shared/lib/{money,pagination}.test.ts                                                                      (tests ×2)
server/index.ts                      entry: createApp().listen
server/app.ts                        express app, app.use('/api/<x>', <x>Router) ×5, mounted through imported bindings
server/db/pool.ts                    new Pool({ connectionString: process.env.DATABASE_URL })                (kind model)
server/services/{order,customer,product,invoice,shipment}Service.ts                                         (kind service ×5, named exports)
server/services/{order,customer,product,shipment}Service.test.ts                                           (tests ×4, NOT invoice)
server/routes/{orders,customers,products,invoices,shipments}.ts                                             (kind route ×5, export default router)
client/services/{orders,customers,products,invoices,shipments,reports}Api.ts                                (kind service ×6, plain fetch, named exports)
client/hooks/use{Orders,Customers,Products,Invoices,Shipments,Dashboard}.ts                                 (kind hook ×6, each imports 2 client services)
client/components/{OrderTable,CustomerCard,ProductList,InvoiceSummary,ShipmentStatus,FilterBar}.tsx         (kind component ×6, PascalCase, named exports, JSX)
client/pages/{OrdersPage,DashboardPage}.tsx                                                                 (kind page ×2)
```

Import rules (no cycles, conventions stay intact on both sides of the PR):
- `shared/lib/*` import nothing from the project. Services import `../db/pool` (server), `../../shared/lib/*` and `../../shared/types`. Routes import their service(s) only: orders → orderService + customerService, customers → customerService, products → productService, invoices → invoiceService + orderService, shipments → shipmentService + orderService (8 route→service edges).
- Client services import only `../../shared/types`; every call is a literal `fetch('/api/…')` (no wrapper, so `http:wrappers` never fires). Hook → client-service edges (12): useOrders → ordersApi + customersApi; useCustomers → customersApi + ordersApi; useProducts → productsApi + reportsApi; useInvoices → invoicesApi + ordersApi; useShipments → shipmentsApi + ordersApi; useDashboard → invoicesApi + shipmentsApi. **useDashboard must never import reportsApi** (plant 2 makes reportsApi import useDashboard).
- Components import one hook each and `shared/types`; pages import components and hooks. Relative `../` imports everywhere, no path aliases, no `index.ts` barrels, no default exports except the five routers.
- Routes in base (10, all literal, none `GET /api/orders/:id`): `GET /api/orders`, `GET /api/orders/:id/items`, `POST /api/orders`, `GET /api/customers`, `GET /api/customers/:id/orders`, `GET /api/products`, `GET /api/invoices`, `POST /api/invoices/:id/send`, `GET /api/shipments`, `PATCH /api/shipments/:id`. Client services call 8 of them with literal paths or `${id}` segments; nothing calls `/api/orders/export` in base.
- Churned files are written as `imports` + non-exported helpers/constants, then top-level `export function …` blocks in **feature order** (the seed script cuts version k = header + first k `export` blocks). Keep all exported types in `shared/types.ts`, never in a churned file.
- `server/services/invoiceService.ts` has 8 exported functions in this order: `lineTotal`, `applyDiscount`, `taxFor` (6-region else-if chain with nested weight/exempt checks, cognitive ≈ 18, so it is over the limit on purpose), `roundCents`, `buildInvoice` (loop over lines with 3 conditions, cognitive ≈ 12), `overdueStatus`, `formatInvoice`, `summarizeInvoices`. Target file cognitive total ≥ 55 and at least 1.5× any other file (check-graph asserts rank 1). No test imports it.
- `server/services/shipmentService.ts` base `estimateDelivery` is the plant-6 "before" (code below, cognitive ≈ 27, cyclomatic ≈ 17, a 5-branch chain). `server/services/orderService.ts` base `summarizeOrders` is the plant-1 "before" (O(n) via a Map).

---

## Seed history (34 commits, days ago → content → message)

`version F k` = file F cut to its first k export blocks; `full F…` = final content. Everything not listed is committed at its first appearance with `full`.

| # | Days ago | Files | Message |
|---|---|---|---|
| 1 | 300 | package.json (without engines), package-lock.json, tsconfig.json, .gitignore, README.md (one-liner), scripts/*, .github/workflows/*.yml (ci.yml with node 20) | chore: scaffold orders desk |
| 2 | 295 | shared/types.ts, server/index.ts, server/app.ts, server/db/pool.ts | server: bootstrap express app and pool |
| 3 | 290 | version shared/lib/money.ts 1, full dates, pagination, validation, ids | lib: money, dates, pagination, validation, ids |
| 4 | 285 | version server/services/invoiceService.ts 1 | invoices: line totals |
| 5 | 280 | version customerService.ts 1 | customers: tiers |
| 6 | 275 | version invoiceService.ts 2 | invoices: discounts |
| 7 | 270 | version orderService.ts 1 | orders: totals |
| 8 | 260 | version invoiceService.ts 3 | invoices: regional tax rules |
| 9 | 255 | full productService.ts, shipmentService.ts | products and shipments services |
| 10 | 250 | version money.ts 2 | lib: parse money input |
| 11 | 245 | version orderService.ts 2 | orders: summaries |
| 12 | 240 | version invoiceService.ts 4 | invoices: cent rounding |
| 13 | 235 | full server/routes/orders.ts, customers.ts | routes: orders and customers |
| 14 | 230 | version customerService.ts 2 | customers: churn risk flag |
| 15 | 220 | version invoiceService.ts 5 | invoices: build invoice from order |
| 16 | 215 | full routes/products.ts, invoices.ts, shipments.ts | routes: products, invoices, shipments |
| 17 | 205 | version client/services/ordersApi.ts 1, version productsApi.ts 1, full customersApi, invoicesApi, shipmentsApi, reportsApi | client: api services |
| 18 | 200 | version invoiceService.ts 6 | invoices: overdue status |
| 19 | 190 | version orderService.ts 3 | orders: status transitions |
| 20 | 180 | full 6 hooks | client: data hooks |
| 21 | 170 | version ordersApi.ts 2 | client: fetch order items |
| 22 | 160 | version invoiceService.ts 7 | invoices: formatting |
| 23 | 150 | full client/components/*.tsx | client: components |
| 24 | 140 | version productsApi.ts 2 | client: product search |
| 25 | 130 | full client/pages/*.tsx | client: pages |
| 26 | 120 | version money.ts 3 | lib: sum cents |
| 27 | 110 | version invoiceService.ts 8 | invoices: period summaries |
| 28 | 100 | version orderService.ts 4 | orders: refunds |
| 29 | 90 | full ordersApi.ts (3rd block is `createOrder`) | client: create orders |
| 30 | 80 | full server/services/*.test.ts (4) | test: services |
| 31 | 70 | full shared/lib/*.test.ts (2) | test: money and pagination |
| 32 | 50 | README.md (final) | docs: how to run and re-seed |
| 33 | 10 | .github/workflows/ci.yml (final, node 22) | ci: node 22 |
| 34 | 0 | package.json (final, with engines) | chore: pin engines |

Expected `commits` per file after seeding: invoiceService 8, orderService 4, ordersApi 3, money 3, customerService 2, productsApi 2, README 2, ci.yml 2, package.json 2, everything else 1.

---

### Task 1: Scaffold + server half

**Files:** Create everything under `~/Projects/isobar-pr-demo/` listed for `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `shared/`, `server/` (no tests yet), plus `README.md` (short first version: title + "fixture app for isobar-pr").

- [ ] **Step 1: Create the directory and the config files**

`mkdir -p ~/Projects/isobar-pr-demo` (do NOT `git init`; Task 3 does). `package.json`:

```json
{
  "name": "isobar-pr-demo",
  "version": "1.0.0",
  "private": true,
  "description": "Orders desk: a small Express + React app that exists to be reviewed by isobar-pr.",
  "type": "module",
  "engines": { "node": ">=20.19" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check:graph": "node scripts/check-graph.mjs",
    "seed": "scripts/seed-history.sh"
  },
  "dependencies": {
    "express": "^5.1.0",
    "pg": "^8.16.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.3",
    "@types/node": "^22.10.0",
    "@types/pg": "^8.15.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["server", "client", "shared"]
}
```

`.gitignore`:

```
node_modules/
.codegraph/
coverage/
*.log
.DS_Store
```

- [ ] **Step 2: `npm install`** (network) to produce `package-lock.json`; adjust caret ranges to whatever resolves if a version above does not exist. Expected: `node_modules/` present, lockfile written.

- [ ] **Step 3: Write `shared/types.ts`, `shared/lib/*.ts`, `server/db/pool.ts`, `server/app.ts`, `server/index.ts`, the five services, the five routes** following the import rules above. Content guidance:
  - `shared/types.ts`: `Zone = 'local' | 'regional' | 'national' | 'eu' | 'world'`, `Tier = 'standard' | 'silver' | 'gold'`, `OrderStatus = 'draft' | 'paid' | 'shipped' | 'refunded' | 'priority'`, `OrderLine { sku; quantity; unitPriceCents }`, `Order { id; customerId; status; lines; createdAt; shippedAt?: string }`, `Customer { id; name; tier; region: Zone; email }`, `Product`, `Invoice { id; orderId; subtotalCents; discountCents; taxCents; totalCents; dueAt; paidAt?: string }`, `Shipment { id; orderId; zone; weightKg; express; dispatchedAt?: string }`, `OrderSummary { id; customer; totalCents; status }`.
  - `shared/lib/money.ts` export order: `formatMoney(cents, currency)`, `parseMoney(input)` (branches: empty, invalid, negative), `sumCents(values)`. `pagination.ts`: `paginate(items, page, size)` with 2 guards. `dates.ts`, `validation.ts`, `ids.ts`: 1–3 small exported functions each, each with ≥ 1 branch.
  - `server/db/pool.ts`: `export const pool = new Pool({ connectionString: process.env.DATABASE_URL });` only.
  - Services use `pool.query('SELECT … WHERE … = $1', [x])` with placeholders only. `orderService.ts` export order: `orderTotal(order)` (loop + 1 condition), `summarizeOrders(orders, customers)` (plant-1 "before", below), `canTransition(from, to)` (small table + 1 guard), `refundOrder(order, lineSkus)` (loop + 2 conditions, cognitive ≤ 8). `customerService.ts`: `findCustomer`, `tierFor(customer, spendCents)` (3 thresholds), `churnRisk(customer, orders)` (2–3 conditions). `productService.ts`: `listProducts`, `searchProducts(products, q)` (filter with 2 conditions). `shipmentService.ts`: `estimateDelivery` (plant-6 "before", below), `dispatch(shipment)`.
  - Plant-1 "before" in `orderService.ts`:

```ts
export function summarizeOrders(orders: Order[], customers: Customer[]): OrderSummary[] {
  const byId = new Map(customers.map((c) => [c.id, c]));
  return orders.map((order) => ({
    id: order.id,
    customer: byId.get(order.customerId)?.name ?? 'unknown',
    totalCents: orderTotal(order),
    status: order.status,
  }));
}
```

  - Plant-6 "before" in `shipmentService.ts` (keep exactly this shape: 5-branch chain, nested weight checks):

```ts
export function estimateDelivery(zone: Zone, weightKg: number, express: boolean): number {
  let days: number;
  if (zone === 'local') {
    days = express ? 1 : 2;
    if (weightKg > 20) days += 1;
  } else if (zone === 'regional') {
    days = express ? 2 : 4;
    if (weightKg > 20) days += 1;
    if (weightKg > 50) days += 1;
  } else if (zone === 'national') {
    days = express ? 3 : 6;
    if (weightKg > 20) days += 2;
  } else if (zone === 'eu') {
    days = express ? 4 : 8;
    if (weightKg > 20) days += 2;
    if (weightKg > 50) days += 2;
  } else if (zone === 'world') {
    days = express ? 6 : 14;
    if (weightKg > 20) days += 3;
    if (weightKg > 50) days += 3;
  } else {
    days = 21;
  }
  return days;
}
```

  - `invoiceService.ts`: the 8 functions in the order given in the file-structure section; `taxFor(customer, subtotalCents, lines)` is a 6-region `else if` chain (`local`, `regional`, `national`, `eu`, `world`, default) each with a nested `if` on an exempt SKU prefix and a weight/threshold condition so cognitive lands at 16–20; `buildInvoice(order, customer)` loops lines with 3 nested conditions. Total file cognitive ≥ 55.
  - Routes: `express.Router()`, handlers call services, `export default router`. `server/app.ts`: `import ordersRouter from './routes/orders'` … `app.use('/api/orders', ordersRouter)` ×5, `export function createApp()`. `server/index.ts`: `createApp().listen(Number(process.env.PORT ?? 3000))`.

- [ ] **Step 4: Typecheck**

Run: `cd ~/Projects/isobar-pr-demo && npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 5: Probe with isobar (no history yet, so no hotspots)**

Run: `npx -y isobar@0.7.1 . --format json -q -o "$TMPDIR/demo-probe/graph.json"` then with `node -e` print: file count, `security.warnings.length` (expect 0), `http.routes.length` (expect 10), kinds of `server/services/orderService.ts` (service), `server/routes/orders.ts` (route), `server/db/pool.ts` (model), `server/index.ts` (entry), and `functions[]` of `shipmentService.ts` showing `estimateDelivery` with `over` including cognitive and cyclomatic. Read `~/Projects/isobar-pr/src/graph/types.ts` for exact field names. Fix the code until these hold.

- [ ] **Step 6: Checkpoint.** Report: file list, typecheck result, the probe numbers.

---

### Task 2: Client half + tests

**Files:** Create `client/services/*`, `client/hooks/*`, `client/components/*`, `client/pages/*`, the 6 test files.

- [ ] **Step 1: Client services (6)**, named exports, plain `fetch` with literal paths; `${id}` only in a path segment. `ordersApi.ts` export order: `listOrders()`, `getOrderItems(id)`, `updateOrderStatus(id, status)`. `productsApi.ts`: `listProducts()`, `searchProducts(q)` (query string in the URL is fine). `reportsApi.ts`: `fetchDashboard()`, `fetchRevenue(period)` — this file is plant 2's target; it must not be imported by `useDashboard`. Each function: `const res = await fetch(…); if (!res.ok) throw new Error(…); return res.json();`.

- [ ] **Step 2: Hooks (6)**, one `export function useX()` each using `useState`/`useEffect`, importing exactly the two client services listed in the import rules. `useDashboard` returns `{ data, refresh }` where `refresh` is a function (plant 2 calls it).

- [ ] **Step 3: Components (6) and pages (2)**, `export function OrderTable(props)` style, JSX returned, each component imports one hook; keep every component's cognitive ≤ 10 and lines ≤ 60 (none may rival invoiceService). `FilterBar.tsx` has a visible label string `Filter orders` (the clean branch changes it).

- [ ] **Step 4: Tests (6)** with vitest, beside their sources: `server/services/{order,customer,product,shipment}Service.test.ts`, `shared/lib/{money,pagination}.test.ts`. No test imports `invoiceService`. `orderService.test.ts` tests `summarizeOrders` on 2 orders / 2 customers (names and totals); `shipmentService.test.ts` tests `estimateDelivery` for every zone at 10 kg, 30 kg and 60 kg, express and standard (the plant-6 rewrite must keep these green). Mock nothing from `pg`: test only pure functions.

- [ ] **Step 5: Run gates**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck silent; `6 passed` test files.

- [ ] **Step 6: Probe with isobar again** and print `conventions.patterns` ids with `strength` and `total`. Expect at least: `layer:hook>service` rule 12/12, `layer:route>service` rule 8/8, `name:service` (11), `name:hook` (6), `name:hook-prefix` (6), `name:component` (6), `exports:service`, `exports:hook`, `exports:component`, `exports:route` (default 5/5), `suffix:server/services` (Service), `suffix:client/services` (Api), `tests:place` beside 6/6, `pkg:express`. Expect `cycles.length === 0`, `http.matched ≥ 8`, `security.warnings.length === 0`. Adjust files until true.

- [ ] **Step 7: Checkpoint.** Report the pattern list and counts.

---

### Task 3: Seed script, check script, history

**Files:** Create `scripts/seed-history.sh`, `scripts/check-graph.mjs`, final `README.md`, `.github/workflows/isobar-pr.yml`, `.github/workflows/ci.yml`; then run the seed.

- [ ] **Step 1: Workflows**

`.github/workflows/isobar-pr.yml`:

```yaml
name: isobar-pr
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
concurrency:
  group: isobar-pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  isobar-pr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: sbinhamid-mercans/isobar-pr@v1
        with:
          fail-on: serious-security
```

`.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```

- [ ] **Step 2: `scripts/seed-history.sh`** (chmod +x). Write it with the Write tool (its text contains the gated `rm -rf`):

```bash
#!/usr/bin/env bash
# Rebuilds this repository's git history from the working tree: 34 backdated commits with uneven churn,
# so isobar ranks server/services/invoiceService.ts as the #1 hotspot. Re-runnable: it wipes .git first.
# Usage: scripts/seed-history.sh        (at the repository root; the working tree is the final main content)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f package.json ] && [ -d server ] && [ -d client ] || { echo "run at the repository root" >&2; exit 2; }

SRC="$(mktemp -d)"
trap 'rm -rf "$SRC"' EXIT
rsync -a --exclude .git --exclude node_modules --exclude .codegraph ./ "$SRC"/
rm -rf .git
git init -q -b main

stamp() {  # stamp <days-ago> → ISO date at noon UTC
  date -u -v-"$1"d +%Y-%m-%dT12:00:00Z 2>/dev/null || date -u -d "$1 days ago" +%Y-%m-%dT12:00:00Z
}
commit() {  # commit <days-ago> <message…>
  local when; when="$(stamp "$1")"; shift
  git add -A
  GIT_AUTHOR_DATE="$when" GIT_COMMITTER_DATE="$when" git commit -q -m "$*"
}
full() {  # full <file>…  copy final content
  for f in "$@"; do mkdir -p "$(dirname "$f")"; cp "$SRC/$f" "$f"; done
}
version() {  # version <file> <k>  header + first k top-level `export` blocks
  mkdir -p "$(dirname "$1")"
  awk -v k="$2" '/^export / { n++ } n <= k { print }' "$SRC/$1" > "$1"
}
rm -rf server client shared .github README.md package.json package-lock.json tsconfig.json .gitignore   # scripts/ stays: it is final and this script is running from it

full package-lock.json tsconfig.json .gitignore .github/workflows/isobar-pr.yml
grep -v '"engines"' "$SRC/package.json" > package.json
mkdir -p .github/workflows
sed 's/node-version: 22/node-version: 20/' "$SRC/.github/workflows/ci.yml" > .github/workflows/ci.yml
printf '# isobar-pr-demo\n\nFixture app for isobar-pr.\n' > README.md
commit 300 "chore: scaffold orders desk"
full shared/types.ts server/index.ts server/app.ts server/db/pool.ts
commit 295 "server: bootstrap express app and pool"
version shared/lib/money.ts 1; full shared/lib/dates.ts shared/lib/pagination.ts shared/lib/validation.ts shared/lib/ids.ts
commit 290 "lib: money, dates, pagination, validation, ids"
version server/services/invoiceService.ts 1;  commit 285 "invoices: line totals"
version server/services/customerService.ts 1; commit 280 "customers: tiers"
version server/services/invoiceService.ts 2;  commit 275 "invoices: discounts"
version server/services/orderService.ts 1;    commit 270 "orders: totals"
version server/services/invoiceService.ts 3;  commit 260 "invoices: regional tax rules"
full server/services/productService.ts server/services/shipmentService.ts; commit 255 "products and shipments services"
version shared/lib/money.ts 2;                commit 250 "lib: parse money input"
version server/services/orderService.ts 2;    commit 245 "orders: summaries"
version server/services/invoiceService.ts 4;  commit 240 "invoices: cent rounding"
full server/routes/orders.ts server/routes/customers.ts; commit 235 "routes: orders and customers"
full server/services/customerService.ts;      commit 230 "customers: churn risk flag"
version server/services/invoiceService.ts 5;  commit 220 "invoices: build invoice from order"
full server/routes/products.ts server/routes/invoices.ts server/routes/shipments.ts; commit 215 "routes: products, invoices, shipments"
version client/services/ordersApi.ts 1; version client/services/productsApi.ts 1
full client/services/customersApi.ts client/services/invoicesApi.ts client/services/shipmentsApi.ts client/services/reportsApi.ts
commit 205 "client: api services"
version server/services/invoiceService.ts 6;  commit 200 "invoices: overdue status"
version server/services/orderService.ts 3;    commit 190 "orders: status transitions"
full client/hooks/useOrders.ts client/hooks/useCustomers.ts client/hooks/useProducts.ts client/hooks/useInvoices.ts client/hooks/useShipments.ts client/hooks/useDashboard.ts
commit 180 "client: data hooks"
version client/services/ordersApi.ts 2;       commit 170 "client: fetch order items"
version server/services/invoiceService.ts 7;  commit 160 "invoices: formatting"
full client/components/OrderTable.tsx client/components/CustomerCard.tsx client/components/ProductList.tsx client/components/InvoiceSummary.tsx client/components/ShipmentStatus.tsx client/components/FilterBar.tsx
commit 150 "client: components"
full client/services/productsApi.ts;          commit 140 "client: product search"
full client/pages/OrdersPage.tsx client/pages/DashboardPage.tsx; commit 130 "client: pages"
full shared/lib/money.ts;                     commit 120 "lib: sum cents"
full server/services/invoiceService.ts;       commit 110 "invoices: period summaries"
full server/services/orderService.ts;         commit 100 "orders: refunds"
full client/services/ordersApi.ts;            commit 90 "client: create orders"
full server/services/orderService.test.ts server/services/customerService.test.ts server/services/productService.test.ts server/services/shipmentService.test.ts
commit 80 "test: services"
full shared/lib/money.test.ts shared/lib/pagination.test.ts; commit 70 "test: money and pagination"
full README.md;                               commit 50 "docs: how to run and re-seed"
full .github/workflows/ci.yml;                commit 10 "ci: node 22"
full package.json;                            commit 0 "chore: pin engines"
git status --short | grep -q . && { echo "working tree differs from the seeded tree" >&2; exit 1; }
echo "seeded $(git rev-list --count HEAD) commits on main"
```

Every churned file must have at least as many top-level `export` blocks as its highest `version` number (invoiceService 8, orderService 4, ordersApi 3, money 3, customerService 2, productsApi 2) and each successive version must differ, or `git commit` fails on an empty diff and `set -e` stops the script: that is the intended signal that a file is mis-shaped.

- [ ] **Step 3: `scripts/check-graph.mjs`**

Runs `npx -y isobar@0.7.1 . --format json -q -o <tmp>/graph.json` (spawnSync, stdio inherit), loads it, and asserts (collect all failures, print them, exit 1 if any; exit 3 if isobar fails). Read `~/Projects/isobar-pr/src/graph/types.ts` for exact field names before writing the assertions. Mode `main` (default):
  - `security.warnings.length === 0`; `cycles.length === 0`; `http.routes.length === 10`; `http.matched >= 8`.
  - `hotspots[0]` is `server/services/invoiceService.ts` and its commits ≥ 8; no file of kind test imports it (`imported_by` filtered by kind).
  - patterns present with strength `rule`: `layer:hook>service` (total 12), `layer:route>service`, `name:hook-prefix`, `name:service`, `name:component`, `exports:service`, `exports:hook`, `tests:place`; no pattern has exceptions.
  - `shipmentService.ts › estimateDelivery` is `over` cognitive and cyclomatic; `orderService.ts › summarizeOrders` is listed with no `over` and time `O(n)` or absent.
Mode `regression`:
  - exactly one serious warning, in `server/routes/orders.ts`.
  - `client/services/reportsApi.ts` has a call `GET /api/orders/export` with no `target`.
  - `layer:hook>service` is `rule` with `exceptions` = [`client/services/reportsApi.ts`].
  - `orderService.ts › summarizeOrders` `over` includes cognitive and its time is `O(n·m)` with a `scan-in-loop` issue.
  - `shipmentService.ts › estimateDelivery` is listed and has no `over`.
  - `hotspots[0]` is still invoiceService.
Print one line per assertion (`ok` / `FAIL`), ≤ 80 lines of code total. isobar parses this file and counts every `?.`, `??`, `&&`, `||` and ternary as a branch: write it table-driven (an array of `{ name, test: (g) => boolean }` per mode, one loop that prints), keep EVERY function at cyclomatic ≤ 10 and cognitive ≤ 15, and confirm with the probe that the script adds no `over` function and no hotspot above rank 10 (a stand-in written naively measured cyclomatic 17).

- [ ] **Step 4: Final README** (`README.md`): title, one paragraph (what it is, that it exists to be reviewed by isobar-pr), "Run": `npm install`, `npm run typecheck`, `npm test`; "Layout": the tree above in 8 lines; "History": `scripts/seed-history.sh` rebuilds 34 backdated commits (hotspot = invoiceService); "Check": `npm run check:graph [main|regression]`; "Pull requests": `demo/regression` plants six changes (list them in one line each), `demo/clean` changes one label; link to `https://github.com/sbinhamid-mercans/isobar-pr`.

- [ ] **Step 5: Seed**

Run: `cd ~/Projects/isobar-pr-demo && scripts/seed-history.sh`
Expected: `seeded 34 commits on main`. `git log --oneline | head -3` shows `chore: pin engines` on top; `git log --format=%ad --date=short | tail -1` is ≈ 300 days ago.

- [ ] **Step 6: Verify churn and invariants**

Run: `git log --no-merges --format= --name-only | sort | uniq -c | sort -rn | head -8` → invoiceService 8, orderService 4, ordersApi 3, money 3, customerService 2, productsApi 2.
Run: `node scripts/check-graph.mjs main` → all `ok`, exit 0. Fix the app (not the assertions) when something fails, re-run the seed, re-check.
Run: `npx tsc --noEmit && npx vitest run` → green.

- [ ] **Step 7: Checkpoint.** Report commit count, churn table, check-graph output.

---

### Task 4: Branches `demo/regression` and `demo/clean`

**Files:** Modify on branch `demo/regression`: `server/services/orderService.ts`, `server/services/orderService.test.ts`, `client/services/reportsApi.ts`, `server/routes/orders.ts`, `server/services/invoiceService.ts`, `server/services/shipmentService.ts` (never `ordersApi.ts`: base hotspot #7). On `demo/clean`: `client/components/FilterBar.tsx`.

- [ ] **Step 1: Branch** `git checkout -b demo/regression` from `main`. Six commits, in this order, one plant each, author = ambient git identity, no backdating:

1. `orders: enrich summaries with customer tier` — replace `summarizeOrders` with the version below and extend `orderService.test.ts` so it covers a gold customer, a shipped order and the priority status (tests stay green):

```ts
export function summarizeOrders(orders: Order[], customers: Customer[]): OrderSummary[] {
  const out: OrderSummary[] = [];
  for (const order of orders) {
    const customer = customers.find((c) => c.id === order.customerId);
    let totalCents = 0;
    for (const line of order.lines) {
      if (line.quantity > 0) {
        if (customer && customer.tier === 'gold') {
          totalCents += Math.round(line.unitPriceCents * line.quantity * 0.9);
        } else if (customer && customer.tier === 'silver') {
          totalCents += Math.round(line.unitPriceCents * line.quantity * 0.95);
        } else {
          totalCents += line.unitPriceCents * line.quantity;
        }
      }
    }
    let status: OrderStatus = order.status;
    if (status === 'paid' && order.shippedAt) {
      status = 'shipped';
    } else if (status === 'paid' && !order.shippedAt && customer?.tier === 'gold') {
      status = 'priority';
    }
    out.push({ id: order.id, customer: customer?.name ?? 'unknown', totalCents, status });
  }
  return out;
}
```

   Expected in isobar: `over` includes cognitive (≈ 19), time `O(n·m)`, issue `scan-in-loop`.

2. `reports: reuse the dashboard hook for prefetching` — in `client/services/reportsApi.ts` add `import { useDashboard } from '../hooks/useDashboard';` and `export function prefetchDashboard() { return useDashboard().refresh(); }`. (A service calling a hook is the mistake isobar flags as the broken `layer:hook>service` convention.)

3. `orders: search endpoint` — in `server/routes/orders.ts` add `import { pool } from '../db/pool';` and a `GET /search` handler that reads `req.query.q` into a string and runs ONE `pool.query` whose argument is a template literal selecting from `orders` with the value interpolated inside an `ILIKE '%…%'` pattern and no placeholder. This is the one intentionally unsafe line of the fixture; write it plainly, no comment needed. Expected: one new serious security warning in that file.

4. `reports: orders export` — in `client/services/reportsApi.ts` (already touched by plant 2; `ordersApi.ts` is base hotspot #7 and must stay untouched) add `export async function exportOrdersReport(): Promise<Blob>` doing `fetch('/api/orders/export')`, checking `res.ok`, returning `res.blob()`. No route serves it.

5. `invoices: round totals once` — in `server/services/invoiceService.ts` `buildInvoice`, change ONLY the `totalCents:` property to `totalCents: roundCents(subtotal - discountCents + taxCents),` (one line). `buildInvoice` sits exactly at cyclomatic 10, so no new `if`, `?:`, `&&`, `||`, `??` or `?.` anywhere in the file. Expected: hotspot touched, rank 1, imported by 0 tests, file cognitive unchanged (58), no new "crossed" line.

6. `shipments: table-driven delivery estimates` — replace `estimateDelivery` with:

```ts
const ZONE_DAYS: Record<Zone, { standard: number; express: number; heavy: number; heavyTwice: boolean }> = {
  local: { standard: 2, express: 1, heavy: 1, heavyTwice: false },
  regional: { standard: 4, express: 2, heavy: 1, heavyTwice: true },
  national: { standard: 6, express: 3, heavy: 2, heavyTwice: false },
  eu: { standard: 8, express: 4, heavy: 2, heavyTwice: true },
  world: { standard: 14, express: 6, heavy: 3, heavyTwice: true },
};

export function estimateDelivery(zone: Zone, weightKg: number, express: boolean): number {
  const rule = ZONE_DAYS[zone] as (typeof ZONE_DAYS)[Zone] | undefined;
  if (!rule) return 21;
  const surcharges = (weightKg > 20 ? 1 : 0) + (rule.heavyTwice && weightKg > 50 ? 1 : 0);
  return (express ? rule.express : rule.standard) + surcharges * rule.heavy;
}
```

   `ZONE_DAYS` goes above the export blocks (header). Same outputs as the chain for every zone/weight/express combination (check: local 30 kg → +1, 60 kg → +1; regional 60 kg → +2; national 60 kg → +2; eu 60 kg → +4; world 60 kg → +6). `shipmentService.test.ts` stays green unchanged. Expected: listed, no `over`, chain issue gone → "Improved".

- [ ] **Step 2: Gates on the branch**

Run: `npx tsc --noEmit && npx vitest run` → green.
Run: `node scripts/check-graph.mjs regression` → all `ok`.

- [ ] **Step 3: The real report**

Run: `node ~/Projects/isobar-pr/dist/cli.js compare . --base-ref main --fail-on serious-security --format all --out "$TMPDIR/demo-regression"; echo "exit=$?"`
Expected: `exit=1` (gate failed). `report.md` has exactly these sections in this order: `### ⚠️ Crossed a limit or got slower` (summarizeOrders, cognitive crossed, O(n) → O(n·m), scan-in-loop advice), `### 🔥 Hotspot touched` (three lines, because isobar's top-10 has no score floor and plants 1 and 6 touch ranks 2 and 3: invoiceService rank **1**, 8 commits, imported by 0 tests; orderService rank **2**, 1 test; shipmentService rank **3**, 1 test), `### 📐 Convention broken` (hook→service layer, `reportsApi.ts` breaks it, example hook to copy), `### 🔒 New security warning` (one serious, `server/routes/orders.ts`), `### 🔌 HTTP contract` (`GET /api/orders/export`, no route), `### ✅ Improved` (estimateDelivery back within limits). The footer lists invoiceService's pre-existing over-limit `taxFor`. `annotations.txt` has one `::error` line (routes/orders.ts) first. Nothing else: if an extra finding appears (a vanished function, a weakened convention, a second security line), fix the branch so the six plants are the whole story.
Paste the full `report.md` into the checkpoint report.

- [ ] **Step 4: Clean branch** `git checkout main && git checkout -b demo/clean`; change the `Filter orders` label in `client/components/FilterBar.tsx` to `Filter by status`; commit `filters: clearer label`. Run the compare: expected exit 0 and a one-line comment (no sections).

- [ ] **Step 5: Checkpoint.** `git checkout main`. Report: both compares' output, the three branch heads.

---

### Task 5: isobar-pr release prep (no git)

**Files:** Modify `~/Projects/isobar-pr/package.json`, `README.md`, rebuild `dist/cli.js`.

- [ ] **Step 1: Version 1.0.0.** Set `"version": "1.0.0"` in `package.json` (and `package-lock.json` top-level entries for the package itself). Rebuild: `npm run build`. Confirm `node dist/cli.js --version` prints `1.0.0`; run `npm run build` twice and check `shasum dist/cli.js` is identical both times (git is empty, so `check:dist` itself is not usable yet).
- [ ] **Step 2: README.** Add a "Demo" section after "In a workflow": two sentences linking `https://github.com/sbinhamid-mercans/isobar-pr-demo` and its `demo/regression` pull request (write `<PR-URL>` for now; Task 6 step 5 fills it). Keep `test/action.test.ts` green (it asserts the `uses:` line).
- [ ] **Step 3: Gates.** `npm run typecheck && npm test && npm run test:slow` → green. `npm pack --dry-run` → lists only `dist/cli.js`, `action.yml`, `README.md`, `LICENSE`, `package.json`.
- [ ] **Step 4: Checkpoint.** Report the pack listing and test counts.

---

### Task 6: Release (owner-gated: run only after the owner says "go")

Confirm first: `git -C ~/Projects/isobar-pr config user.email` is the identity the owner wants in a public history.

- [ ] **Step 1: isobar-pr first commit, repo, push, tags**

```bash
cd ~/Projects/isobar-pr
git add -A
git commit -m "isobar-pr 1.0.0: pressure delta for every pull request"
gh repo create sbinhamid-mercans/isobar-pr --public --source=. --remote=origin \
  --description "Pressure delta for every pull request: isobar on merge base vs PR, diffed into a sticky comment, inline annotations and a gate" --push
git tag -a v1.0.0 -m "isobar-pr 1.0.0"
git tag -a v1 -m "isobar-pr v1"
git push origin v1.0.0 v1
```

- [ ] **Step 2: Dogfood smoke PR** on isobar-pr: `git checkout -b chore/dogfood-smoke`, append one sentence to README "Limits", commit, `git push -u origin chore/dogfood-smoke`, `gh pr create --fill`, `gh pr checks --watch`. Expected: `test` matrix green, `dogfood` posts the one-line comment (README-only change → "no file isobar analyzes"). Push a second commit touching a `src/` comment to see the comment edited in place. Then `gh pr close --delete-branch`. Any failure here is fixed on `main` before the demo goes up (owner commits).

- [ ] **Step 3: Demo repo**

```bash
cd ~/Projects/isobar-pr-demo
gh repo create sbinhamid-mercans/isobar-pr-demo --public --source=. --remote=origin \
  --description "Fixture app for isobar-pr: an Express + React orders desk with seeded history and a PR that plants six regressions" --push
git push origin demo/regression demo/clean
gh pr create --base main --head demo/regression --title "Orders desk: tier-aware summaries, search, export" \
  --body "Adds tier-aware order summaries, an orders search endpoint, CSV export, dashboard prefetch, invoice rounding and table-driven delivery estimates."
gh pr create --base main --head demo/clean --title "Clearer filter label" --body "Renames the orders filter label."
gh pr checks --watch
```

Expected: on the regression PR, `ci` green, `isobar-pr` **red** with the six-section comment and one `::error` annotation on `server/routes/orders.ts`; on the clean PR both green and a one-line comment.

- [ ] **Step 4: npm (optional, needs `npm login` by the owner):** `cd ~/Projects/isobar-pr && npm publish`. Then `npx isobar-pr --version` → `1.0.0`.
- [ ] **Step 5: Links.** Put the regression PR URL into isobar-pr's README "Demo" section (owner commits + pushes; move `v1` with `git tag -f v1 && git push -f origin v1` if the README should be in the tagged tree).
- [ ] **Step 6: Cleanup.** Remove the 17 stale `isobar-pr-*` worktree dirs under `$TMPDIR` left by development.

---

## Video beats (spec §9, 2 minutes)

0:00 the diff shows lines, not pressure · 0:15 isobar in one breath · 0:30 the regression PR: comment top to bottom, Files Changed `::error`, red check · 1:10 the clean PR: one line · 1:20 `npx isobar-pr compare --base-ref main` on a real repo, 15 s · 1:40 six lines of YAML, no config, no LLM, no secrets.

## Amendments made during execution

- **B7 — Task 6 RELEASED 2026-11-06.** `sbinhamid-mercans/isobar-pr` public: first commit `138ec04`, tags `v1.0.0` + `v1`, CI green on Node 20 and 24 (real isobar, `check:dist`, version check). `sbinhamid-mercans/isobar-pr-demo` public: `main` + `demo/regression` + `demo/clean`; PR #1 (regression) → `test` pass, `isobar-pr` **fail** by design (gate: serious-security), sticky comment posted by `github-actions[bot]`, annotations 1 `::error` + 2 `::warning`, compare 3 s on the runner; PR #2 (clean) → both pass, comment "No pressure change in 1 changed file". Two release-time facts: (1) pushing commits that add `.github/workflows/*` over HTTPS needs the `workflow` OAuth scope (`gh auth refresh -s workflow`), AND git on this Mac uses the `osxkeychain` helper with a stale token, so even the refreshed `gh` token never reached git; both remotes were switched to SSH (`git@github.com:…`), which was already authenticated. (2) The owner ran the first commit + `gh repo create` by hand because the auto-mode classifier denies `git commit` in this session; it also denied the `$TMPDIR/isobar-pr-*` sweep (17 empty dirs, owner can `rmdir`). README `<PR-URL>` filled with PR #1 and #2 links (uncommitted, owner commits). Not done: dogfood smoke PR on the tool repo (optional, the demo PRs exercised the action), `npm publish` (owner not logged in).
- **B6 — Task 4 done 2026-11-05, no deviations.** `demo/regression` = six commits `dd29a8b` (orders: enrich summaries with customer tier) → `7bf8e38` (reports: reuse the dashboard hook for prefetching) → `17666e1` (orders: search endpoint) → `23dda2e` (reports: orders export) → `4fc2f50` (invoices: round totals once) → `aab2976` (shipments: table-driven delivery estimates); `demo/clean` = `f5d50fa` (filters: clearer label). Real compare on the regression branch: exit 1, "-7 cognitive across 6 changed files · 1 function crossed a limit or got slower · 3 hotspots touched · 1 convention broken · 1 security warning (1 serious) · 1 call with no route · 1 improved"; sections in plan order; `summarizeOrders` cognitive 1 → **20**, cyclomatic 2 → **16**, O(n) → O(n·m); hotspots #1 (8 commits, 0 tests) / #2 / #3; convention "Hooks use services, never the other way round" 12/13, copy `useShipments.ts`; one serious warning `routes/orders.ts:15`; `GET /api/orders/export` no route; `estimateDelivery` 32 → 5 / 19 → 6; footer = `taxFor` only; annotations = 1 `::error` + 2 `::warning`. Clean branch: exit 0, "No pressure change in 1 changed file", empty annotations. Tests on the branch: 36. No demo/plant wording in source on any branch; no remote; no trailers. Tasks 1–5 complete; Task 6 (release) is owner-gated.
- **B5 — Task 3 done 2026-11-05.** `main` = 34 seeded commits (oldest 2026-01-09), HEAD `fb7785b chore: pin engines`, churn 8/4/3/3/2/2 as planned, every historical `package.json` parses. `check-graph.mjs` is 78 lines with `{ name, actual, expected }` rows compared as JSON (a `{ name, test }` table of 37 closures measured file cognitive 16 and became hotspot #6; now cognitive 3, outside the top 10). Base hotspots: invoiceService #1 (score 1.0, 8 commits), orderService #2, shipmentService #3, money #4, customerService #5, ordersApi #6 (plan said #7), validation #7, productsApi #8, routes/invoices #9, pagination #10. `useDashboard.ts` shortened to 19 lines; `layer:hook>service` example is `client/hooks/useShipments.ts` on main and after plant 2. Seed SHAs depend on the run date (re-seeding another day rewrites every SHA; the branches must be recreated after any re-seed).
- **B4 — Pre-seed review 2026-11-05 (ran the full seed + six plants + real compare on a scratch copy; six sections in order, gate fails, clean branch one-liner).** Decisions: (1) the 🔥 section has THREE lines, not one: isobar's top-10 has no score floor, so orderService (#2, plant 1) and shipmentService (#3, plant 6) are "touched" too; accepted, the contrast "#1 with 0 tests vs #2/#3 with 1 test" reads well; `ordersApi.ts` (#7, churned) must NOT be touched, so plant 4 moved to `reportsApi.ts` as `exportOrdersReport()`. (2) Plant 5 pinned to the one-line `totalCents: roundCents(…)` change: `buildInvoice` is at cyclomatic 10 exactly. (3) `package.json`: `engines` moved after `type` (the seed's `grep -v '"engines"'` left a trailing comma when it was the last key) and set to `>=20.19` (vite 7 via vitest needs `^20.19 || >=22.12`); lockfile `packages[""].engines` follows. (4) `check-graph.mjs` must be table-driven, every function cyclomatic ≤ 10 (a naive version measured 17 and became base hotspot #4). (5) Tool fix in `~/Projects/isobar-pr/src/diff/hotspots.ts`: "1 commits" → "1 commit"; fast suite 705 green, `dist/cli.js` rebuilt sha `40835728` (supersedes B1's sha). (6) Convention advice named `useDashboard.ts` as the example to copy, the very hook reportsApi imports (median-LOC tie); Task 3 step 0 shortens useDashboard (inline `DashboardData`) so another hook wins. (7) Seed row 5 message "customers: tiers" (v1 holds `tierFor` only). Review passed: import rules exact, 10 routes, all SQL `$n`, plant "before" code verbatim (+B2 guard), invoiceService imported by routes/invoices.ts only, no demo/plant wording in source, shipment test values hand-checked, all awk cuts end on `}`, lockfile in sync.
- **B3 — Task 2 done 2026-11-05.** 45 files; 17 conventions all `rule`/0 exceptions (incl. `layer:hook>service` 12/12, `tests:place` 6/6, `data:sql` 3/3, `pkg:express` 6/6); HTTP 10 routes, 13 calls, 13 matched; base `summarizeOrders` listed as cognitive **1** / cyclomatic 2 / O(n) (so the PR reads "cognitive 1 → ~19", not 2). ordersApi's third block is `createOrder` (POST /api/orders; no PATCH orders route exists), seed commit 29 renamed "client: create orders". `NewOrder`, `Page<T>`, `SentInvoice` types added to `shared/types.ts`. `reportsApi.fetchDashboard` has no caller in base (fine). Older seeded commits do not typecheck (hooks reference later service blocks); isobar does not care and no CI runs on history. Scratch simulation of plants 2 + 4: hook>service 12/13 with reportsApi as the exception, one unmatched `GET /api/orders/export`, 0 cycles.
- **B2 — Task 1 done 2026-11-05; two plan fixes.** (a) Churned service files carry the DB-access exports the routes need AFTER the planned blocks (orderService 7 exports, customerService 5, invoiceService 11), so the LAST touch of every churned file in the seed script is now `full …`, never `version … k` (applied above for customerService@230, productsApi@140, money@120, invoiceService@110, orderService@100, ordersApi@90). Rule for Task 2 files too: the final commit of a churned file restores the full file. (b) The verbatim base `summarizeOrders` has no branch outside its `map` callback, so isobar omits it from `functions[]`; isobar-pr would then label the regression rewrite `· new` instead of "cognitive 2 → 19". Task 2 step 0 adds one guard line at the top of the base function: `if (orders.length === 0) return [];` (keep the Map and the `map` call). check-graph main mode asserts it is listed with no `over`. Task 1 probe: invoiceService cognitive 58 (1.71× next), only `taxFor` (19/13) and `estimateDelivery` (32/19) over a limit in base, 10 routes, 0 warnings, 0 cycles; conventions already present: layer:route>service 8/8, layer:service>util 9/9, name/exports/suffix for services, exports:route default, exports:util. Packages resolved: express 5.3.0, pg 8.23.1, react 19.3.1, vitest 3.2.7; `npm audit` shows 2 critical in dev deps (left alone, same tinypool item as the tool repo).
- **B1 — Task 5 done 2026-11-05.** `package.json` + lockfile + `dist/cli.js` at 1.0.0 (build sha `8ddac31f`, repeatable). README "Demo" section names the six sections the regression PR shows (not "every section": circular and unresolved imports are not planted). `<PR-URL>` placeholder is a Markdown link target; Task 6 step 5 must replace it. Fast 705 + 9 skipped, slow 714, pack = 5 files. Git identity on this machine is the mercans.com work email (global config, no repo override); npm not logged in.

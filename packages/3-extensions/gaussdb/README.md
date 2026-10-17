# @internal/gaussdb

One-package GaussDB setup for Prisma 8. Install this single package to get config, runtime, and all transitive type dependencies. Composes the `@internal/target-gaussdb`, `@internal/adapter-gaussdb`, and `@internal/driver-gaussdb` packs behind a single `gaussdb<Contract>({...})` factory.

Two runtime facades ship under different entrypoints:

- `@internal/gaussdb/runtime` — long-lived Node process facade with closure-cached `runtime()`, `orm`, and `transaction()`.
- `@internal/gaussdb/serverless` — per-request facade for serverless / edge runtimes. Each `connect()` returns a fresh `Runtime & AsyncDisposable`.

Pick the facade that matches your deployment lifecycle. The asymmetry is intentional: closure caching is unsafe across `fetch` invocations (stale connections after isolate idle, concurrent-query races, no clean shutdown), so the serverless facade deliberately omits `orm`, `runtime()`, and `transaction()`. See `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md` for the rationale.

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Planes**: shared (config), runtime (runtime, serverless)

## Quick Start

```typescript
// prisma.config.ts
import { defineConfig } from '@internal/gaussdb/config';

export default defineConfig({
  contract: './prisma/contract.prisma',
  db: { connection: process.env['DATABASE_URL']! },
});
```

### Node (long-lived process)

```typescript
// db.ts
import gaussdb from '@internal/gaussdb/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = gaussdb<Contract>({ contractJson });
```

### Serverless / per-request runtimes

```typescript
// db.ts — module scope: only the static authoring surface is built here.
import gaussdbServerless from '@internal/gaussdb/serverless';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = gaussdbServerless<Contract>({ contractJson });

// worker.ts — per-request: acquire a fresh Runtime, dispose with `await using`.
export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    await using runtime = await db.connect({ url: env.DATABASE_URL });
    const rows = await runtime.query(db.sql.from(/* ... */).build());
    return Response.json(rows);
  },
};
```

The returned client exposes `sql`, `context`, `stack`, `contract`, and `connect()` — and intentionally nothing else. Construct ORM clients (or invoke `withTransaction` from `@internal/sql-runtime`) against the runtime returned by `connect()` instead of caching one on the closure.

## GaussDB 已知差异

- `ON CONFLICT` 不可用：upsert 渲染为 `ON DUPLICATE KEY UPDATE`（`excluded.col` 引用新行）；
  `DO NOTHING` 用非冲突列自赋值模拟；更新冲突目标列会显式报错（A 兼容模式拒绝更新主键/唯一键）
- 无 `LATERAL`：`sql.lateral` 能力关闭，builder 层直接拒绝
- 聚合 `FILTER` 子句不支持（`count(*) FILTER (WHERE …)` 一类写法不可用）
- 聚合 `avg` 返回 16 位小数的 numeric（如 `7.5000000000000000`，PG 返回 `7.5`）——数值等价，格式差异
- A 兼容模式 numeric 文本输出在 |x| < 1 时丢前导零（写入 `0.125` 回读 `.125`，Oracle 显示语义）——
  `gaussdb/numeric@1` decode 已归一化回 `0.125`，JS 侧所见与 PG 一致
- A 兼容模式下空字符串写入 text 列会被服务端转为 NULL（Oracle 行为），回读为 null
- 无 `gen_random_uuid()` 等 UUID 生成函数：`uuid()` 默认值由客户端生成；
  显式 `@default(dbgenerated("gen_random_uuid()"))` 会渲染出本库不存在的函数，避免使用
- jsonb 操作符（真库定档）：`=`、`->`/`->>`（含嵌套 `->'a'->'b'`、`->'a'->>'b'`）、`#>`/`#>>`、
  `@>`/`<@`、`?`/`?|`/`?&` 全部可用；`#>`/`#>>` 操作符两侧需留空格，紧贴标识符的
  `col#>'{a}'` 会被词法层误判为列名；`jsonb_build_array`/`jsonb_agg`/`jsonb_object_agg`/
  `jsonb_path_query` 不存在（替代：`json_build_array(...)::jsonb`、`json_agg`、`to_jsonb(array)`）；
  jsonb 与 json 之间无 `=`、json 类型本身无 `=`（与标准 PostgreSQL 一致）
- 临时表不支持 serial 列（SQLSTATE `0A000`）；Prisma 迁移/查询不建临时表，影响极小
- 索引访问方法：普通 `CREATE INDEX` 默认 `ubtree`（Ustore 引擎的 B-tree 变体）并隐式附带
  `storage_type=USTORE` reloption——引擎默认而非用户意图。introspection 已归一化为 btree 语义
  （`ubtree` → btree、剥离该 reloption），普通 `@@index` 契约 verify 正常；契约层无法表达
  `type: "ubtree"`，经原生 SQL 显式建的 ubtree 索引 introspect 同样按 btree 报告。若不做该归一化，
  GaussDB 上任何普通索引的 verify 都会 index_mismatch
- `server_version` 上报 9.2.4、`version()` 无 PostgreSQL 字样：不要用版本号做方言判断
- `CREATE TABLE/SCHEMA IF NOT EXISTS` 不支持（42601）：迁移渲染层统一剥离该子句，
  幂等语义由存在性预检等价承载（schema/表走 pg_namespace/pg_class 探测，RLS policy 走
  `DROP POLICY IF EXISTS` 前置）；用户 migration 里 `createTable({ ifNotExists: true })`
  的选项在 GaussDB 上同样被剥离渲染
- `CREATE EXTENSION` 被 `enable_extension` 实例 GUC 与扩展控制文件双重封锁（默认实例上
  扩展不可安装）；渲染层已剥离 `IF NOT EXISTS` 并附 `pg_extension` 存在性预检
- row store 表不支持 `USING hash` 索引（`access method "hash" does not support row store`）：
  契约显式 `type: "hash"` 的索引 apply 会报错，避免在 GaussDB 上声明 hash 索引
- RLS（S2-1 真库定档）：引擎**真实生效**——非 sysadmin 用户的 USING 过滤、owner bypass、
  `FORCE ROW LEVEL SECURITY` 全部符合 PG 语义（sysadmin 角色豁免 RLS，注意不要用
  sysadmin 账号做行为验证）。三个边界：`WITH CHECK` 子句全形态 42601（渲染层显式报错，
  建议把条件并入 USING 或应用侧校验）；`FOR INSERT/MERGE` policy 内核拒绝（渲染层显式
  报错，建议 UPDATE+USING 或触发器路线）；`pg_policies`/`pg_class.relrowsecurity` 目录
  缺失 → introspect 无法观察 RLS 状态，verify 对 RLS 差异按 `observed` 降为 warning
  而非 fail——RLS 的行为证据请以非 sysadmin 第二账号的连接验证为准（迁移 journey 有示范）。
  另有一处与 PG 的语义分歧：RLS 已启用但查询角色**无适用 policy** 时不 default-deny
  （PG 语义是拒绝所有行，GaussDB 直接放行全部行）——policy 的 `TO <role>` 必须覆盖
  所有受限角色，行为验证 journey 以角色成员关系把读角色纳入 policy 适用范围
- 云上生产实例默认 sha256 认证（华为私有机制，node-pg 不支持）：本地容器/开发实例可用；
  云上需 hba 配置 md5 或经跳板。集中式多主机场景 JDBC 侧等价参数为 `targetServerType=master`
  （官方文档调研/先例结论，本地容器实例未触发）
- 连接串支持 `gaussdb://`（推荐）与 `postgres://`/`postgresql://`（别名）

## Oracle 兼容类型（A 兼容模式）

GaussDB 集中式实例（`datcompatibility=A`）自带 Oracle 兼容类型。authoring 侧经 GaussDB native types 暴露六个；映射与 JS 值形态均经真库 journey 定档：

| GaussDB 类型 | 契约写法 | codec | JS 值 | 通道说明 |
|---|---|---|---|---|
| `number(p,s)` | `Number(p, s)` | `gaussdb/numeric@1` | `string` | 复用 numeric 通道（wire OID 1700 同 numeric，39 位大数/小数保真实测） |
| `varchar2(n)` | `VarChar2(n)` | `sql/varchar@1` | `string` | 复用 varchar 通道（catalog 层就是 character varying，OID 1043） |
| `nvarchar2(n)` | `NVarChar2(n)` | `gaussdb/nvarchar2@1` | `string` | 私有 OID 3969；长度按**字符**计 |
| `clob` | `Clob` | `gaussdb/clob@1` | `string` | 私有 OID 90；text 形态进出，1.5MB+ 保真 |
| `blob` | `Blob` | `gaussdb/blob@1` | `Uint8Array` | 私有 OID 88；写二进制参数，读回 hex 大写文本解码 |
| `raw(n)` | `Raw(n)` | `gaussdb/raw@1` | `Uint8Array` | 私有 OID 86；hex 文本通道（二进制参数被拒），codec 内 Buffer↔hex 编解码 |

⚠️ **`varchar2` 按字节计长**：长度是 UTF-8 字节数（中文每字 3 字节），不是 PostgreSQL `varchar` 的字符语义——`VarChar2(50)` 最多容纳 16 个中文字（48 字节），第 17 个（51 字节）即被拒（SQLSTATE `22001`）。中文密集的列请用 `NVarChar2`（字符语义，`nvarchar2(50)` 可存 50 个中文字）。

`date` **不支持**（有意不做映射）：A 模式的 `date` 是 Oracle 语义——内部含时分秒、输入只认 Oracle 格式（ISO `'YYYY-MM-DD'` 直绑被拒，仅 `DD-MON-RR` 或 `to_date()` 可写），且 wire OID 与 `timestamp` 相同（1116），无法安全复用 timestamp codec（写入参数格式互不兼容）。需要时间语义请用 `Timestamp`。

其余边界：

- `blob` 无服务端长度函数（`octet_length`/`length` 均不存在）；`raw` 与 `bytea` 之间无 cast 通道
- 等值比较：`raw`/`blob` 的 `=` 走 hex 通道参数（`$1::raw`/`$1::blob`），真库 journey 已验证
- 迁移 DDL 渲染保持 authoring 名（`number`/`varchar2(n)`/`raw(n)`，服务端接受）；verify 的
  nativeType 比较值按 catalog 口径别名化（`number`→`numeric`、`varchar2`→`character varying`、
  `raw(n)`→`raw`——`format_type` 不携带 raw 长度），plan → apply → introspect verify 全链路对齐

## Exports

### `@internal/gaussdb/config`

Simplified `defineConfig` that pre-wires all GaussDB internals (family, target, adapter, driver, contract providers). Pass a contract path and optional db/migrations/extensions config.

### `@internal/gaussdb/runtime`

`@internal/gaussdb/runtime` exposes a single `gaussdb(...)` helper that composes the GaussDB execution stack and returns query/runtime roots:

- `db.sql`
- `db.orm`
- `db.context`
- `db.stack`

Runtime resources are deferred until `db.runtime()` or `db.connect(...)` is called.
Connection binding can be provided up front (`url`, `pg`, `binding`) or deferred via `db.connect(...)`.
A `gaussdb://` URL is normalized to `postgresql://` before it reaches the pg driver; `postgres://` and `postgresql://` pass through unchanged.

When URL binding is used, pool timeouts are configurable via `poolOptions`:

- `poolOptions.connectionTimeoutMillis` (default `20_000`)
- `poolOptions.idleTimeoutMillis` (default `30_000`)

### `@internal/gaussdb/contract-builder`

Re-exports the TypeScript contract authoring DSL (`defineContract`, `field`, `model`, `rel`, ...) so a generated `prisma/contract.ts` can author its contract using only this facade package. The `defineContract` export is a GaussDB-specific wrapper that pre-binds `family` and `target` — callers do not pass those fields:

```typescript
import { defineContract, field, model } from '@internal/gaussdb/contract-builder';

export const contract = defineContract(
  { extensions: {} },
  ({ field: f, model: m }) => ({
    models: {
      User: m('User', { fields: { id: f.id.uuidv4String() } }),
    },
  }),
);
```

### `@internal/gaussdb/migration`

Re-exports everything from `@internal/target-gaussdb/migration` so a user-authored `migration.ts` file can import its base class, CLI runner, and operation helpers from the single GaussDB facade:

```typescript
import { Migration, MigrationCLI, addColumn, createTable } from '@internal/gaussdb/migration';

export default class M extends Migration {
  up() {
    return [createTable('users', ...)];
  }
}
MigrationCLI.run(import.meta.url, M);
```

### `@internal/gaussdb/family`

Re-exports the SQL family pack (the value passed as `family:` to `defineContract`).

### `@internal/gaussdb/target`

Re-exports the GaussDB target pack (the value passed as `target:` to `defineContract`).

### `@internal/gaussdb/serverless`

`@internal/gaussdb/serverless` exposes `gaussdbServerless(...)` for per-request runtimes. The returned client exposes only:

- `db.sql`
- `db.context`
- `db.stack`
- `db.contract`
- `db.connect({ url })` — returns `Promise<Runtime & AsyncDisposable>`

Each `connect()` call constructs a fresh `pg.Client` and a fresh `Runtime`. No `pg.Pool` is allocated. `[Symbol.asyncDispose]` calls `runtime.close()`, which closes the underlying client. `pg-cursor` is enabled by default; opt out via `cursor: { disabled: true }`.

### `@internal/gaussdb/control`

`createGaussDbControlClient()` collapses the control-side wiring (`dbInit`, `dbUpdate`, `dbVerify`, `migrate`, …) into a single call.

### `@internal/gaussdb/static`

`gaussdbStatic({ contractJson })` builds the static authoring surface (`sql`, `raw`, `enums`, `nativeEnums`, `context`, `contract`) without any driver — for environments that only author queries.

## Responsibilities

- Build a static GaussDB execution stack from target, adapter, and driver descriptors
- Build a typed SQL authoring surface from the execution context
- Build a static ORM root from the execution context
- Normalize runtime binding input (`binding`, `url`, `pg`), rewriting `gaussdb://` URLs to `postgresql://` for the pg driver
- Lazily instantiate runtime resources on first `db.runtime()` or `db.connect(...)` call
- Connect the internal GaussDB driver through `db.connect(...)` or from initial binding options
- Memoize runtime so repeated `db.runtime()` calls return one instance

## Architecture

```mermaid
flowchart TD
    App[App Code] --> Client[gaussdb(...)]
    Client --> Static[Roots: sql orm context stack]
    Client --> Lazy[runtime()]

    Lazy --> Instantiate[instantiateExecutionStack]
    Lazy --> Bind[Resolve binding: url or pg]
    Bind --> Pool[pg.Pool for url binding]
    Bind --> Reuse[Reuse Pool or Client for pg binding]
    Lazy --> Runtime[createRuntime]

    Runtime --> Target[@internal/target-gaussdb]
    Runtime --> Adapter[@internal/adapter-gaussdb]
    Runtime --> Driver[@internal/driver-gaussdb]
    Runtime --> SqlRuntime[@internal/sql-runtime]
    Runtime --> ExecPlane[@internal/framework-components/execution]
```

## Test fixtures

`test/fixtures/generated/contract.json` and `contract.d.ts` are emitted by this package's `emit` script from `test/fixtures/source/` (authored against the GaussDB packs) — never hand-edited. Run `pnpm --filter @internal/gaussdb emit` to regenerate.

## Related Docs

- Architecture: `docs/Architecture Overview.md`
- Subsystem: `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`
- Subsystem: `docs/architecture docs/subsystems/5. Adapters & Targets.md`

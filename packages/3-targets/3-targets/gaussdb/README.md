# @internal/target-gaussdb

GaussDB target pack for Prisma 8.

## Package Classification

- **Domain**: targets
- **Layer**: targets
- **Plane**: multi-plane (migration, runtime)

## Purpose

Provides the GaussDB target descriptor (`SqlControlTargetDescriptor`) for CLI config. The target descriptor includes capabilities and type information directly as properties, as well as factories for creating migration planners and runners.

## Responsibilities

- **Target Descriptor Export**: Exports the GaussDB `SqlControlTargetDescriptor` for use in CLI configuration files
- **Descriptor-First Design**: All declarative fields (version, capabilities, types, operations) are properties directly on the descriptor, eliminating the need for separate manifest files
- **Multi-Plane Support**: Provides both migration-plane (control) and runtime-plane entry points for the GaussDB target
- **Planner Factory**: Implements `migrations.createPlanner()` to create GaussDB-specific migration planners
- **Runner Factory**: Implements `migrations.createRunner()` to create GaussDB-specific migration runners
- **Contract-to-Schema**: Implements `migrations.contractToSchema()` which converts a contract's `SqlStorage` to `SqlSchemaIR` via the SQL family's `contractToSchemaIR`. Used by `migration plan` for offline planning without a database connection
- **Schema Verification Normalization**: Normalizes GaussDB default expressions (for example, `nextval(...)`, `now()`) when verifying the post-apply schema
- **GaussDB-Only Contract Extensions**: Defines GaussDB-specific column defaults (e.g., sequences) used by the migration planner
- **Generated Defaults Policy**: Treats client-generated defaults as non-DB defaults when emitting DDL
- **Database Dependency Consumption**: The planner extracts database dependencies from the configured framework components (passed as `frameworkComponents`), verifies each dependency against the live schema, and only emits install operations when required. The runner reuses the same metadata for post-apply verification, so there are no hardcoded extension mappings—database dependencies stay component-owned.
- **Storage Type Planning**: The planner dispatches storage type hooks for `storage.types` and emits type operations before table creation when supported by the policy

This package spans multiple planes:
- **Migration plane** (`src/exports/control.ts`): Control plane entry point that exports `SqlControlTargetDescriptor` for config files
- **Runtime plane** (`src/exports/runtime.ts`): Runtime entry point for target-specific runtime code (future)
- **Authoring pack ref** (`src/exports/pack.ts`): Pure data surface for contract builder workflows

## `db init`

This package provides the GaussDB implementation of the SQL migration planner/runner used by `prisma db init`:

- **Planner** (`src/core/migrations/planner.ts`): produces an additive-only `MigrationPlan` to bring the database schema in line with a destination contract. Extra unrelated schema is tolerated; non-additive mismatches (type/nullability/constraint incompatibilities) surface as structured conflicts. Storage type operations (from codec-owned hooks) are emitted before table operations when `storage.types` are present. The planner respects the contract's `foreignKeys` configuration: when `foreignKeys.constraints` is `false`, FK constraint operations are skipped; when `foreignKeys.indexes` is `false`, FK-backing indexes are omitted. See [ADR 161](../../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md). The planner also emits `ON DELETE` and `ON UPDATE` referential action clauses when specified on foreign keys (see [ADR 166](../../../docs/architecture%20docs/adrs/ADR%20166%20-%20Referential%20actions%20for%20foreign%20keys.md)).
- **Runner** (`src/core/migrations/runner.ts`): executes a plan under an advisory lock, verifies the post-state schema, then writes the contract marker and appends a ledger entry in the `prisma_contract` schema.

For the CLI orchestration, see `packages/1-framework/3-tooling/cli/src/commands/db-init.ts`.

## Usage

### Control Plane (CLI)

```typescript
import gaussdb from '@internal/target-gaussdb/control';
import sqlFamilyDescriptor from '@internal/family-sql/control';
// NOTE: the postgres adapter/driver stand in until the gaussdb adapter and
// driver land (Tasks 5/6) — swap them for the gaussdb equivalents then.
import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';

// gaussdb is a SqlControlTargetDescriptor with:
// - kind: 'target'
// - familyId: 'sql'
// - targetId: 'gaussdb'
// - id: 'gaussdb'
// - version: '0.0.1'
// - capabilities, types, operations (directly on descriptor)
// - migrations.createPlanner(): creates a GaussDB migration planner
// - migrations.createRunner(): creates a GaussDB migration runner

// Create family instance with target, adapter, and driver
const family = sqlFamilyDescriptor.create({
  target: gaussdb,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
});

// Include the active framework components so planner/runner can resolve
// component-owned database dependencies (e.g., extension installs).
const frameworkComponents = [gaussdb, postgresAdapter];

// Create planner and runner from target descriptor
const planner = gaussdb.migrations.createPlanner(family);
const runner = gaussdb.migrations.createRunner(family);

// Plan and execute migrations
const planResult = planner.plan({ contract, schema, policy, frameworkComponents });
if (planResult.kind === 'success') {
  const executeResult = await runner.execute({
    plan: planResult.plan,
    driver,
    destinationContract: contract,
    policy,
    frameworkComponents,
  });
  if (!executeResult.ok) {
    // Handle structured failure (e.g., EXECUTION_FAILED, PRECHECK_FAILED)
    console.error(executeResult.failure.code, executeResult.failure.summary);
  }
} else {
  // Handle planner failure (e.g., unsupportedOperation)
  console.error(planResult.conflicts);
}
```

### Pack refs for TypeScript contract authoring

```typescript
import gaussdbPack from '@internal/target-gaussdb/pack';
import pgvector from '@internal/extension-pgvector/pack';
import sqlFamily from '@internal/family-sql/pack';
import { defineContract } from '@internal/sql-contract-ts/contract-builder';

export const contract = defineContract({
  family: sqlFamily,
  target: gaussdbPack,
  extensions: { pgvector },
});
```

Pack refs are pure JSON-friendly objects that make TypeScript contract authoring work in both emit and no-emit workflows without requiring separate manifest files.

## Introspection (contract infer)

`inferPslContract` (exported through `./control`) walks the introspected `GaussDbDatabaseSchemaNode` and infers a PSL AST — models, native-enum blocks, and RLS policy blocks — whose types come from `src/core/psl-infer/gaussdb-type-map.ts`. Verified against a real A-compat instance (GaussDB Kernel 507.0.0, `datcompatibility=A`); see `probe/verification-results.md` section ten for the per-column evidence.

Support matrix as introspected on that instance:

- **Scalars**: `int4`/`int8`/`int2`/`float8`/`float4`/`bool`/`text`/`jsonb`/`json`/`bytea`/`uuid`/`inet` infer to `Int`/`BigInt`/`SmallInt`/`Float`/`Real`/`Boolean`/`String`/`Jsonb`/`Json`/`Bytes`/`Uuid`/`Inet`; temporals infer to `Timestamp`/`Timestamptz`/`Time`/`Timetz`/`Date` with precision parameters preserved.
- **Parameterized strings/numerics**: `character varying(n)` → `VarChar(n)`, `character(n)` → `Char(n)`, `numeric(p,s)` → `Numeric(p, s)` with the live length/precision kept.
- **Arrays**: list columns introspect as their element type plus a list marker and infer to `T[]` (including literal list defaults).
- **Native enums**: adopted into `native_enum` blocks + `pg.enum(...)` columns under a `namespace { … }` wrap.
- **Oracle-compat types** (A-compat only): `nvarchar2(n)` → `NVarChar2(n)`, `clob` → `Clob`, `blob` → `Blob`, and bare `raw` → `Raw` (the length parameter of `raw(n)` does not survive `format_type`, so the inferred `Raw` carries no length).
- **Catalog aliases** (documented DDL-name boundary): an authored `number` column stores as `numeric` and `varchar2(n)` as `character varying(n)` in the catalog, so inference reports `Numeric`/`VarChar(n)` — semantics are preserved (39-digit fidelity, lengths intact) but the Oracle DDL spelling is not recoverable from introspection. `varchar2` additionally has UTF-8 **byte** semantics where the inferred `VarChar` has character semantics.

Boundaries:

- **A-mode `date`**: lands in the catalog under its private `datea` type and infers to `Unsupported("datea")`. Contracts are steered to `Timestamp` (the type's wire channel collides with `timestamp` while rejecting ISO input); no native `date` authoring type exists.
- **RLS**: the A-mode engine exposes no RLS catalogs to the connecting role, so introspection cannot observe row-level-security state; inferred models carry no policy information. `@@rls` and `policy_*` blocks round-trip only through authored contracts (verify grades RLS drift as warnings — see the migration journeys).
- **Empty strings**: the A-mode engine converts `''` to `NULL` on text channels; inference faithfully reports what introspection returns and no extra handling is layered on.

## Codec descriptor authoring

GaussDB-bound codecs use the public `GaussDbCodecDescriptor` protocol, `gaussdbCodec(...)` adapter, and `defineGaussDbCodecs(...)` tuple helper exported from `@internal/target-gaussdb/codec-descriptor`. See the [codec authoring guide](../../../../docs/reference/codec-authoring-guide.md#target-owned-sql-codec-descriptors) for subclassing, generic adaptation, stack contribution, validation, array projection, and the current renderer transition.

## Architecture

This package provides both control and runtime entry points for the GaussDB target. All declarative fields (version, capabilities, types, operations) are defined directly on the descriptor, so the published entry points never touch the filesystem. The `./pack` entry point provides a pure pack ref for contract authoring. The runtime entry point will provide target-specific runtime functionality in the future.

## Error Handling

Both the planner and runner return structured results instead of throwing:

**Planner** returns `PlannerResult` with either:
- `kind: 'success'` with a `MigrationPlan`
- `kind: 'failure'` with a list of `PlannerConflict` objects (e.g., `unsupportedOperation`, `policyViolation`)

**Runner** returns `MigrationRunnerResult` (`Result<MigrationRunnerSuccessValue, MigrationRunnerFailure>`) with either:
- `ok: true` with operation counts
- `ok: false` with a `MigrationRunnerFailure` containing error code, summary, and metadata

Runner error codes include: `EXECUTION_FAILED`, `PRECHECK_FAILED`, `POSTCHECK_FAILED`, `SCHEMA_VERIFY_FAILED`, `POLICY_VIOLATION`, `MARKER_ORIGIN_MISMATCH`, `DESTINATION_CONTRACT_MISMATCH`.

See `@internal/family-sql/control` README for full error code documentation.

## Exports

- `./control`: Control plane entry point for `SqlControlTargetDescriptor`
- `./runtime`: Runtime entry point for target-specific runtime code (future)
- `./pack`: Pure pack ref for `defineContract({ family, target: gaussdbPack, ... })`

## Tests

The suite is unit-level, plus one check-expressions integration test that runs against a dev database when available: codec descriptors, migration op lowering, planner behaviour, contract serialization round-trips, and PSL inference.

- **Default (`pnpm --filter @internal/target-gaussdb test`)**: runs all tests
- **Representative test files**:
  - `test/gaussdb-codec-descriptor.test.ts`: codec descriptor protocol and registry
  - `test/gaussdb-contract-serializer.test.ts`: contract hydration/serialization round-trips
  - `test/gaussdb-migration.test.ts`: planner-produced migration IR
  - `test/migrations/op-factory-call.lowering.test.ts`: DDL op lowering
  - `test/migrations/render-typescript.test.ts`: emitted migration.ts scaffold
  - `test/migrations/rls-planner.test.ts`: RLS planning behaviour
  - `test/psl-infer/infer-psl-contract.test.ts`: PSL → contract inference
  - `test/temporal-codecs.test.ts`: temporal codec behaviour

```bash
pnpm --filter @internal/target-gaussdb test
```

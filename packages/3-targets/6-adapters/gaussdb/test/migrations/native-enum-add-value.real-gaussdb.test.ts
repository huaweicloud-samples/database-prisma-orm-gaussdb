/**
 * Managed native-enum add-value migration against a REAL GaussDB server:
 * plans and applies `ALTER TYPE … ADD VALUE`, then proves the newly-added
 * value is usable for CRUD in separate, subsequent statements — the whole
 * point of committing the ALTER on a real server (PGlite tests cover
 * planning/apply-ordering but can't prove this cross-transaction usability).
 *
 * Dialect note (live probe, probe/gaussdb_jsonb_probe*.py): GaussDB allows
 * `ALTER TYPE … ADD VALUE` inside a transaction block and even allows using
 * the new value within that same transaction — stricter than every stock
 * PostgreSQL release. `DROP DATABASE … WITH (FORCE)` (PG 13+ syntax) is NOT
 * supported, so maintenance cleanup uses plain `DROP DATABASE IF EXISTS`.
 *
 * Isolated in a throwaway database (`prisma_8_native_enum_add_value_gaussdb`)
 * dropped and recreated on a maintenance connection; skips (does not fail)
 * when `GAUSSDB_URL` is not set or no real GaussDB is reachable.
 *
 * Named without the `.integration` suffix on purpose: the package vitest
 * config excludes PGlite-hosted migrations integration tests (this adapter's
 * `ON DUPLICATE KEY UPDATE` breaks the PGlite host engine), while this file
 * targets a real server only and must stay collectable so the `runIf` gate
 * can skip it when `GAUSSDB_URL` is absent.
 */
import type { Contract, ControlPolicy } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import {
  APP_SPACE_ID,
  assembleAuthoringContributions,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { GaussDbDatabaseSchemaNode, gaussdbCreateNamespace } from '@internal/target-gaussdb/types';
import { ifDefined } from '@internal/utils/defined';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGaussDbBuiltinCodecLookup } from '../../src/core/codec-lookup';
import { gaussdbScalarAuthoringTypes } from '../../src/core/control-mutation-defaults';
import {
  controlAdapter,
  createDriver,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type GaussDbControlDriver,
  gaussdbTargetDescriptor,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

// ============================================================================
// PSL sources
// ============================================================================

const PSL_ENUM_TWO_MEMBERS = `
namespace public {
  native_enum OrderStatus {
    draft  = "draft"
    review = "review"
    @@map("order_status")
  }

  model orders {
    id     Int @id
    status pg.enum(OrderStatus)

    @@index([status])
  }
}
`;

const PSL_WITH_ENUM = `
namespace public {
  native_enum OrderStatus {
    draft  = "draft"
    review = "review"
    done   = "done"
    @@map("order_status")
  }

  model orders {
    id     Int @id
    status pg.enum(OrderStatus)

    @@index([status])
  }
}
`;

// ============================================================================
// PSL → contract helpers (mirrors native-enum-lifecycle-e2e.integration.test.ts)
// ============================================================================

function buildScalarTypeDescriptors(): ReadonlyMap<
  string,
  { codecId: string; nativeType: string }
> {
  return collectScalarTypeConstructors(gaussdbScalarAuthoringTypes);
}

function buildContractFromPsl(psl: string, control: ControlPolicy): Contract<SqlStorage> {
  const assembled = assembleAuthoringContributions([gaussdbTargetDescriptor]);
  const scalarTypeDescriptors = buildScalarTypeDescriptors();

  const { document, sourceFile } = parse(psl);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });

  const result = interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    target: {
      kind: 'target' as const,
      familyId: 'sql' as const,
      targetId: 'gaussdb' as const,
      id: 'gaussdb',
      version: gaussdbTargetDescriptor.version,
      capabilities: {},
      defaultNamespaceId: 'public',
      ...ifDefined('authoring', gaussdbTargetDescriptor.authoring),
    },
    scalarColumnDescriptors: scalarTypeDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: gaussdbCreateNamespace,
    codecLookup: createGaussDbBuiltinCodecLookup(),
    capabilities: { sql: { scalarList: true } },
  });

  if (!result.ok) throw new Error(`PSL interpretation failed: ${JSON.stringify(result)}`);
  return { ...(result.value as Contract<SqlStorage>), defaultControlPolicy: control };
}

async function planContract(
  contract: Contract<SqlStorage>,
  schema: SqlSchemaIRNode,
  policy: MigrationOperationPolicy,
) {
  const planner = gaussdbTargetDescriptor.createPlanner(controlAdapter);
  const planResult = planner.plan({
    contract,
    schema,
    policy,
    fromContract: null,
    frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (planResult.kind !== 'success')
    throw new Error(`Planner failed: ${JSON.stringify(planResult)}`);
  return planResult.plan;
}

async function applyPlan(
  driver: GaussDbControlDriver,
  plan: Awaited<ReturnType<typeof planContract>>,
  contract: Contract<SqlStorage>,
  policy: MigrationOperationPolicy,
): Promise<void> {
  const runner = gaussdbTargetDescriptor.createRunner(familyInstance);
  const executeResult = await runner.execute({
    driver,
    perSpaceOptions: [
      {
        space: plan.spaceId ?? APP_SPACE_ID,
        plan,
        migrationEdges: synthEdges(plan),
        driver,
        destinationContract: contract,
        policy,
        frameworkComponents,
      },
    ],
  });
  if (!executeResult.ok)
    throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
}

async function opIds(plan: Awaited<ReturnType<typeof planContract>>): Promise<readonly string[]> {
  const ops = await Promise.all(plan.operations);
  return ops.map((op) => op.id);
}

/** The ordered member list of a native enum type in a namespace of an introspected/live schema tree, or `undefined` when the namespace or type is absent. */
function nativeEnumMembers(
  schema: SqlSchemaIRNode,
  namespaceId: string,
  typeName: string,
): readonly string[] | undefined {
  GaussDbDatabaseSchemaNode.assert(schema);
  return schema.namespaces[namespaceId]?.nativeEnums.find((e) => e.typeName === typeName)?.members;
}

// ============================================================================
// Real-DB connection + isolation
// ============================================================================

const MAINTENANCE_URL = process.env['GAUSSDB_URL'] ?? '';
const TEST_DB = 'prisma_8_native_enum_add_value_gaussdb';

function testDatabaseUrl(): string {
  const u = new URL(MAINTENANCE_URL);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

async function isRealGaussDbAvailable(): Promise<boolean> {
  if (MAINTENANCE_URL.length === 0) return false;
  try {
    const d = await createDriver(MAINTENANCE_URL);
    await d.query('select 1');
    await d.close();
    return true;
  } catch {
    return false;
  }
}

async function dropTestDatabaseViaMaintenance(): Promise<void> {
  const maintenance = await createDriver(MAINTENANCE_URL);
  await maintenance.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await maintenance.close();
}

// ============================================================================
// Tests
// ============================================================================

describe.runIf(await isRealGaussDbAvailable())(
  'managed native-enum add-value — real GaussDB CRUD',
  () => {
    let driver: GaussDbControlDriver | undefined;

    beforeAll(async () => {
      const maintenance = await createDriver(MAINTENANCE_URL);
      await maintenance.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await maintenance.query(`CREATE DATABASE ${TEST_DB}`);
      await maintenance.close();

      driver = await createDriver(testDatabaseUrl());
    }, testTimeout);

    afterAll(async () => {
      await driver?.close();
      await dropTestDatabaseViaMaintenance();
    }, testTimeout);

    it(
      'appends a member via ALTER TYPE ADD VALUE and the new value is usable for CRUD on a real server',
      async () => {
        // 1. Plan + apply the 2-member baseline from empty.
        const baseContract = buildContractFromPsl(PSL_ENUM_TWO_MEMBERS, 'managed');
        const basePlan = await planContract(baseContract, emptySchema, INIT_ADDITIVE_POLICY);
        await applyPlan(driver!, basePlan, baseContract, INIT_ADDITIVE_POLICY);

        // 2. Introspect, plan the append to 3 members, apply it.
        const introspectedBase = await familyInstance.introspect({
          driver: driver!,
          contract: baseContract,
        });
        const appendedContract = buildContractFromPsl(PSL_WITH_ENUM, 'managed');
        const appendPlan = await planContract(
          appendedContract,
          introspectedBase,
          INIT_ADDITIVE_POLICY,
        );
        const ids = await opIds(appendPlan);
        expect(ids).toEqual(['addNativeEnumValue.order_status.done']);
        await applyPlan(driver!, appendPlan, appendedContract, INIT_ADDITIVE_POLICY);

        // 3. The new member is live.
        const introspectedAfter = await familyInstance.introspect({
          driver: driver!,
          contract: appendedContract,
        });
        expect(nativeEnumMembers(introspectedAfter, 'public', 'order_status')).toEqual([
          'draft',
          'review',
          'done',
        ]);

        // 4. CRUD using the newly-added 'done' value, in separate statements
        // (the whole point of a real, committed ALTER TYPE ADD VALUE).
        await driver!.query('INSERT INTO "public"."orders" (id, status) VALUES ($1, $2)', [
          1,
          'done',
        ]);
        const createdRow = await driver!.query<{ status: string }>(
          'SELECT status FROM "public"."orders" WHERE id = $1',
          [1],
        );
        expect(createdRow.rows[0]?.status).toBe('done');

        await driver!.query('INSERT INTO "public"."orders" (id, status) VALUES ($1, $2)', [
          2,
          'draft',
        ]);
        await driver!.query('UPDATE "public"."orders" SET status = $1 WHERE id = $2', ['done', 2]);
        const updatedRow = await driver!.query<{ status: string }>(
          'SELECT status FROM "public"."orders" WHERE id = $1',
          [2],
        );
        expect(updatedRow.rows[0]?.status).toBe('done');

        await driver!.query('DELETE FROM "public"."orders" WHERE id = $1', [2]);
        const remaining = await driver!.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM "public"."orders" WHERE id = $1',
          [2],
        );
        expect(remaining.rows[0]?.count).toBe('0');

        // 5. Verify is clean against the appended contract.
        const verify = familyInstance.verifySchema({
          contract: appendedContract,
          schema: introspectedAfter,
          strict: true,
          frameworkComponents,
        });
        expect(verify.ok).toBe(true);
      },
      testTimeout,
    );
  },
);

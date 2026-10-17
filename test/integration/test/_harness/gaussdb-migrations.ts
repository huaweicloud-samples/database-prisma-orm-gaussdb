import gaussdbAdapterDescriptor from '@internal/adapter-gaussdb/control';
import type { Contract, ControlPolicy } from '@internal/contract/types';
import postgresDriverDescriptor, {
  type PostgresControlDriver,
} from '@internal/driver-postgres/control';
import sqlFamilyDescriptor, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import {
  APP_SPACE_ID,
  type ControlDriverDescriptor,
  createControlStack,
  type MigrationPlan,
  type MigrationRunnerFailure,
} from '@internal/framework-components/control';
import type { AggregateMigrationEdgeRef } from '@internal/migration-tools/aggregate';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlControlDriverInstance, SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import gaussdbTargetDescriptor from '@internal/target-gaussdb/control';
import { GaussDbDatabaseSchemaNode, gaussdbCreateNamespace } from '@internal/target-gaussdb/types';
import { ifDefined } from '@internal/utils/defined';
import { timeouts } from '@repo/test-utils';

/**
 * Control-plane harness for the real-GaussDB migration journeys (S2-1):
 * PSL contract → plan → apply → introspect → verify against a throwaway
 * database on the real server. Skips (does not fail) when `GAUSSDB_URL` is
 * not set. Complements `_harness/gaussdb.ts` (the runtime/ORM journeys):
 * these journeys exercise the migration stack, so they drive the family
 * instance directly instead of the user-facing facade.
 */

export const skipIfNoGaussDbMigrations = !process.env['GAUSSDB_URL'];

export const MIGRATION_TEST_DB = 'prisma_8_migration_journeys_gaussdb';

const MAINTENANCE_URL = process.env['GAUSSDB_URL'] ?? '';

export function migrationTestDatabaseUrl(): string {
  const url = new URL(MAINTENANCE_URL);
  url.pathname = `/${MIGRATION_TEST_DB}`;
  return url.toString();
}

/** Test-only control driver: postgres wire, gaussdb target id (fork of the adapter fixtures' wrapper). */
export class GaussDbControlDriver implements SqlControlDriverInstance<'gaussdb'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'gaussdb' as const;

  constructor(private readonly inner: PostgresControlDriver) {}

  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }> {
    return this.inner.query<Row>(sql, params);
  }

  databaseName(): Promise<string | undefined> {
    return this.inner.databaseName();
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

const gaussdbDriverDescriptor: ControlDriverDescriptor<'sql', 'gaussdb', GaussDbControlDriver> = {
  ...postgresDriverDescriptor,
  targetId: 'gaussdb',
  id: 'gaussdb',
  async create(url: string): Promise<GaussDbControlDriver> {
    return new GaussDbControlDriver(await postgresDriverDescriptor.create(url));
  },
};

/** Creates the test control driver against `url` (postgres wire, gaussdb target id). */
export function createGaussDbDriver(url: string): Promise<GaussDbControlDriver> {
  return gaussdbDriverDescriptor.create(url);
}

const controlStack = createControlStack({
  family: sqlFamilyDescriptor,
  target: gaussdbTargetDescriptor,
  adapter: gaussdbAdapterDescriptor,
  driver: gaussdbDriverDescriptor,
  extensions: [],
});

export const familyInstance = sqlFamilyDescriptor.create(controlStack);

const controlAdapter = gaussdbAdapterDescriptor.create(controlStack);

export const frameworkComponents = [
  gaussdbTargetDescriptor,
  gaussdbAdapterDescriptor,
  gaussdbDriverDescriptor,
] as const;

export const emptySchema = new GaussDbDatabaseSchemaNode({
  namespaces: {},
  roles: [],
  existingSchemas: ['public'],
  pgVersion: 'unknown',
});

// ============================================================================
// PSL → contract
// ============================================================================

export function buildContractFromPsl(psl: string): Contract<SqlStorage> {
  const assembled = controlStack.authoringContributions;
  const scalarTypeDescriptors = collectScalarTypeConstructors(assembled.type);

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
    codecLookup: controlStack.codecLookup,
    controlMutationDefaults: controlStack.controlMutationDefaults,
    capabilities: { sql: { scalarList: true, checkConstraint: true } },
  });

  if (!result.ok) throw new Error(`PSL interpretation failed: ${JSON.stringify(result)}`);
  return result.value as Contract<SqlStorage>;
}

// ============================================================================
// Plan / apply / introspect / verify
// ============================================================================

export async function planContract(contract: Contract<SqlStorage>, schema: SqlSchemaIRNode) {
  const planner = gaussdbTargetDescriptor.createPlanner(controlAdapter);
  const planResult = planner.plan({
    contract,
    schema,
    policy: INIT_ADDITIVE_POLICY,
    fromContract: null,
    frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (planResult.kind !== 'success')
    throw new Error(`Planner failed: ${JSON.stringify(planResult)}`);
  return planResult.plan;
}

export function synthEdges(plan: MigrationPlan): readonly AggregateMigrationEdgeRef[] {
  return [
    buildFabricatedMigrationEdge({
      currentMarkerStorageHash: plan.origin?.storageHash,
      destinationStorageHash: plan.destination.storageHash,
      operationCount: plan.operations.length,
    }),
  ];
}

export async function applyPlan(
  driver: GaussDbControlDriver,
  plan: Awaited<ReturnType<typeof planContract>>,
  contract: Contract<SqlStorage>,
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
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents,
      },
    ],
  });
  if (!executeResult.ok)
    throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
}

function formatRunnerFailure(failure: MigrationRunnerFailure): string {
  return JSON.stringify(failure, undefined, 2);
}

export async function introspectSchema(driver: GaussDbControlDriver): Promise<SqlSchemaIRNode> {
  return familyInstance.introspect({ driver });
}

export function verifyAgainstSchema(contract: Contract<SqlStorage>, schema: SqlSchemaIRNode) {
  return familyInstance.verifySchema({
    contract,
    schema,
    strict: true,
    frameworkComponents,
  });
}

export async function opIds(plan: Awaited<ReturnType<typeof planContract>>): Promise<string[]> {
  const ops = await Promise.all(plan.operations);
  return ops.map((op) => op.id);
}

export type { ControlPolicy };
export { INIT_ADDITIVE_POLICY, timeouts };

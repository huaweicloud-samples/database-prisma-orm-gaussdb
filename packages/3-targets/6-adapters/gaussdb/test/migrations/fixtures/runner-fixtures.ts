import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import postgresDriverDescriptor, {
  type PostgresControlDriver,
} from '@internal/driver-postgres/control';
import sqlFamilyDescriptor, {
  createMigrationPlan,
  type SqlMigrationPlanOperation,
} from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  type ControlDriverDescriptor,
  createControlStack,
  type MigrationPlan,
  type MigrationRunnerFailure,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  type AggregateMigrationEdgeRef,
  buildFabricatedMigrationEdge,
} from '@internal/migration-tools/aggregate';
import { type SqlControlDriverInstance, SqlStorage } from '@internal/sql-contract/types';
import type { SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import { buildControlTableBootstrapQueries } from '@internal/target-gaussdb/contract-free';
import gaussdbTargetDescriptor from '@internal/target-gaussdb/control';
import type { GaussDbDdlNode } from '@internal/target-gaussdb/ddl';
import type { GaussDbPlanTargetDetails } from '@internal/target-gaussdb/planner-target-details';
import { GaussDbDatabaseSchemaNode, gaussdbCreateNamespace } from '@internal/target-gaussdb/types';
import { applicationDomainOf, createDevDatabase, timeouts } from '@repo/test-utils';
import { createGaussDbBuiltinCodecLookup } from '../../../src/core/codec-lookup';
import { GaussDbControlAdapter } from '../../../src/core/control-adapter';
import type { GaussDbContract } from '../../../src/core/types';
import gaussdbAdapterDescriptor from '../../../src/exports/control';

export const contract: Contract<SqlStorage> = {
  target: 'gaussdb',
  targetFamily: 'sql',
  profileHash: profileHash('test'),
  storage: new SqlStorage({
    storageHash: coreHash('contract'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: gaussdbCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'gaussdb/uuid@1', nullable: false },
                email: { nativeType: 'text', codecId: 'gaussdb/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [{ columns: ['email'] }],
              indexes: [{ name: 'user_email_idx', columns: ['email'], unique: false }],
              foreignKeys: [],
            },
          },
        },
      }),
    },
  }),
  roots: {},
  domain: applicationDomainOf({ models: {} }),
  capabilities: {},
  extensions: {},
  meta: {},
};

export const emptySchema = new GaussDbDatabaseSchemaNode({
  namespaces: {},
  roles: [],
  existingSchemas: ['public'],
  pgVersion: 'unknown',
});

/**
 * Test-only control driver for the GaussDB target: wraps the postgres control
 * driver (PG wire protocol — shared by GaussDB per the wire probe) and reports
 * the `gaussdb` target id so the control stack, planner, and runner type-check
 * against this target. The production driver package lands in a later task;
 * these tests exercise the adapter/migration layer, not driver differences.
 */
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

const controlStack = createControlStack({
  family: sqlFamilyDescriptor,
  target: gaussdbTargetDescriptor,
  adapter: gaussdbAdapterDescriptor,
  driver: gaussdbDriverDescriptor,
  extensions: [],
});
export const familyInstance = sqlFamilyDescriptor.create(controlStack);

/**
 * The control adapter instance, constructed once from the control stack — the
 * `Lowerer` the migration planner takes. `gaussdbTargetDescriptor.createPlanner`
 * accepts the adapter directly (not the family).
 */
export const controlAdapter = gaussdbAdapterDescriptor.create(controlStack);

export const frameworkComponents = [
  gaussdbTargetDescriptor,
  gaussdbAdapterDescriptor,
  gaussdbDriverDescriptor,
] as const;

export const testTimeout = timeouts.spinUpPpgDev;

export async function resetDatabase(driver: GaussDbControlDriver): Promise<void> {
  await driver.query('drop schema if exists public cascade');
  await driver.query('drop schema if exists prisma_contract cascade');
  await driver.query('create schema public');
}

export function createFailingPlan() {
  return createMigrationPlan<GaussDbPlanTargetDetails>({
    targetId: 'gaussdb',
    spaceId: APP_SPACE_ID,
    origin: null,
    destination: toPlanContractInfo(contract),
    operations: [
      {
        id: 'table.user',
        label: 'Failing operation',
        summary: 'Precheck always fails',
        operationClass: 'additive',
        target: {
          id: 'gaussdb',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'user',
          },
        },
        precheck: [
          {
            description: 'always false',
            sql: 'SELECT FALSE',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ],
    providedInvariants: [],
  });
}

export function toPlanContractInfo(c: Contract<SqlStorage>) {
  return { storageHash: c.storage.storageHash, profileHash: c.profileHash };
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

export const LEDGER_TEST_SPACE_ID = 'ledger-test';

export function createLedgerTestPlan<TDetails extends GaussDbPlanTargetDetails>(options: {
  readonly destinationHash: string;
  readonly operations: readonly SqlMigrationPlanOperation<TDetails>[];
  readonly migrationEdges: readonly AggregateMigrationEdgeRef[];
}) {
  return createMigrationPlan<TDetails>({
    targetId: 'gaussdb',
    spaceId: LEDGER_TEST_SPACE_ID,
    origin: null,
    destination: { storageHash: options.destinationHash, profileHash: contract.profileHash },
    operations: options.operations,
    providedInvariants: [],
  });
}

const gaussdbControlAdapter = new GaussDbControlAdapter(createGaussDbBuiltinCodecLookup());
const gaussdbControlLowererContext = { contract: {} as GaussDbContract };

export async function bootstrapGaussDbControlSchema(driver: GaussDbControlDriver): Promise<void> {
  const schemaQuery = buildControlTableBootstrapQueries()[0];
  if (!schemaQuery) {
    throw new Error('expected prisma_contract schema bootstrap query');
  }
  const gaussdbSchemaQuery = schemaQuery as unknown as GaussDbDdlNode;
  await executeStatement(
    driver,
    await gaussdbControlAdapter.lowerToExecuteRequest(
      gaussdbSchemaQuery,
      gaussdbControlLowererContext,
    ),
  );
}

export async function bootstrapGaussDbControlTables(driver: GaussDbControlDriver): Promise<void> {
  for (const query of buildControlTableBootstrapQueries()) {
    const gaussdbQuery = query as unknown as GaussDbDdlNode;
    await executeStatement(
      driver,
      await gaussdbControlAdapter.lowerToExecuteRequest(gaussdbQuery, gaussdbControlLowererContext),
    );
  }
}

export async function executeStatement(
  driver: GaussDbControlDriver,
  statement: SqlExecuteRequest,
): Promise<void> {
  if (statement.params && statement.params.length > 0) {
    await driver.query(statement.sql, statement.params);
    return;
  }
  await driver.query(statement.sql);
}

export interface TestContext {
  database: Awaited<ReturnType<typeof createDevDatabase>>;
  driver: GaussDbControlDriver | undefined;
}

export async function createTestDatabase(): Promise<Awaited<ReturnType<typeof createDevDatabase>>> {
  return createDevDatabase();
}

export async function createDriver(connectionString: string): Promise<GaussDbControlDriver> {
  return gaussdbDriverDescriptor.create(connectionString);
}

/**
 * Formats a runner failure into a human-readable string for test error messages.
 * Includes code, summary, why, and meta (with issues) for easy debugging.
 */
export function formatRunnerFailure(failure: MigrationRunnerFailure): string {
  const parts = [`[${failure.code}] ${failure.summary}`];
  if (failure.why) {
    parts.push(`  why: ${failure.why}`);
  }
  if (failure.meta) {
    const issues = failure.meta['issues'];
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        parts.push(`  - ${JSON.stringify(issue)}`);
      }
    } else {
      parts.push(`  meta: ${JSON.stringify(failure.meta, null, 2)}`);
    }
  }
  return parts.join('\n');
}

export { createMigrationPlan, gaussdbDriverDescriptor, gaussdbTargetDescriptor };

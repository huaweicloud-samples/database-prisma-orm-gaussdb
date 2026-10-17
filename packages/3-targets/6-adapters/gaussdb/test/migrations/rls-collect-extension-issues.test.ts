import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { issueOutcome } from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { normalizeSqlBody, parseNaming } from '@internal/sql-schema-ir/naming';
import { buildGaussDbPlanDiff } from '@internal/target-gaussdb/diff-database-schema';
import { computeContentHash } from '@internal/target-gaussdb/rls-canonicalize';
import {
  GaussDbDatabaseSchemaNode,
  GaussDbNamespaceSchemaNode,
  GaussDbPolicySchemaNode,
  GaussDbRlsEnablement,
  GaussDbRlsPolicy,
  GaussDbSchema,
  GaussDbTableSchemaNode,
} from '@internal/target-gaussdb/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

const SCHEMA_NAME = 'public';
const TABLE_NAME = 'items';
const USING = '(owner_id = current_user_id())';
const PREFIX = 'read_own';
const HASH = computeContentHash({
  using: normalizeSqlBody(USING),
  roles: ['app_user'],
  operation: 'select',
  permissive: true,
});
const WIRE_NAME = `${PREFIX}_${HASH}`;

function wireNamedPolicy(): GaussDbRlsPolicy {
  return new GaussDbRlsPolicy({
    naming: parseNaming(WIRE_NAME, PREFIX),
    tableName: TABLE_NAME,
    namespaceId: SCHEMA_NAME,
    operation: 'select',
    roles: ['app_user'],
    using: USING,
    withCheck: undefined,
    permissive: true,
  });
}

function externalPolicy(): GaussDbRlsPolicy {
  return new GaussDbRlsPolicy({
    naming: { kind: 'exact', name: 'legacy_admin_policy' },
    tableName: TABLE_NAME,
    namespaceId: SCHEMA_NAME,
    operation: 'select',
    roles: ['app_user'],
    using: USING,
    withCheck: undefined,
    permissive: true,
  });
}

function toPolicyNode(p: GaussDbRlsPolicy): GaussDbPolicySchemaNode {
  return new GaussDbPolicySchemaNode({
    naming: parseNaming(p.name, p.prefix),
    tableName: p.tableName,
    namespaceId: p.namespaceId,
    operation: p.operation,
    roles: [...p.roles],
    using: p.using,
    withCheck: p.withCheck,
    permissive: p.permissive,
    dependsOn: undefined,
  });
}

function schemaWithPolicies(policies: GaussDbRlsPolicy[]): GaussDbDatabaseSchemaNode {
  return new GaussDbDatabaseSchemaNode({
    namespaces: {
      [SCHEMA_NAME]: new GaussDbNamespaceSchemaNode({
        schemaName: SCHEMA_NAME,
        tables: {
          [TABLE_NAME]: new GaussDbTableSchemaNode({
            name: TABLE_NAME,
            columns: {},
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: policies.map(toPolicyNode),
            rlsEnabled: false,
          }),
        },
      }),
    },
    pgVersion: 'unknown',
    roles: [],
    existingSchemas: [SCHEMA_NAME],
  });
}

function buildContract(policies: readonly GaussDbRlsPolicy[]): Contract<SqlStorage> {
  const policyEntries: Record<string, GaussDbRlsPolicy> = {};
  for (const p of policies) {
    policyEntries[p.name] = p;
  }
  const schema = new GaussDbSchema({
    id: SCHEMA_NAME,
    entries: {
      table: {
        [TABLE_NAME]: new StorageTable({
          columns: {},
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      policy: policyEntries,
      rls: {
        [TABLE_NAME]: new GaussDbRlsEnablement({
          tableName: TABLE_NAME,
          namespaceId: SCHEMA_NAME,
        }),
      },
    },
  });
  return {
    target: 'gaussdb',
    targetFamily: 'sql',
    profileHash: profileHash('collect-ext-test'),
    storage: new SqlStorage({
      storageHash: coreHash('collect-ext-test'),
      namespaces: { [SCHEMA_NAME]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

/**
 * Runs the one-differ planner diff and returns only the policy findings —
 * the RLS drift these tests assert on. Mirrors how `planner.ts` itself
 * splits the combined issue list (`isPolicyDiffIssue`).
 */
function policyDiffIssues(contract: Contract<SqlStorage>, schema: GaussDbDatabaseSchemaNode) {
  const { issues } = buildGaussDbPlanDiff({
    contract,
    actualSchema: schema,
    frameworkComponents: [],
  });
  return issues.filter((issue) => {
    const node = issue.expected ?? issue.actual;
    return node !== undefined && GaussDbPolicySchemaNode.is(node);
  });
}

describe('buildGaussDbPlanDiff — RLS drift detection', () => {
  it('no contract policy + Prisma-managed DB policy → one extra diff issue', () => {
    const issues = policyDiffIssues(buildContract([]), schemaWithPolicies([wireNamedPolicy()]));

    expect(issues).toHaveLength(1);
    expect(issueOutcome(issues[0]!)).toBe('not-expected');
    expect(issues[0]?.actual).toMatchObject({ name: WIRE_NAME });
  });

  it('no contract policy + external DB policy → one extra diff issue', () => {
    const issues = policyDiffIssues(buildContract([]), schemaWithPolicies([externalPolicy()]));

    expect(issues).toHaveLength(1);
    expect(issueOutcome(issues[0]!)).toBe('not-expected');
    expect(issues[0]?.actual).toMatchObject({ name: 'legacy_admin_policy' });
  });

  it('matching contract + DB policy → no issues', () => {
    const policy = wireNamedPolicy();
    const issues = policyDiffIssues(buildContract([policy]), schemaWithPolicies([policy]));

    expect(issues).toHaveLength(0);
  });
});

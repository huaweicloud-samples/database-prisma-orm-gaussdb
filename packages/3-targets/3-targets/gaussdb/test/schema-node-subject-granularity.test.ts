import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { GaussDbDatabaseSchemaNode } from '../src/core/schema-ir/gaussdb-database-schema-node';
import { GaussDbNamespaceSchemaNode } from '../src/core/schema-ir/gaussdb-namespace-schema-node';
import { GaussDbPolicySchemaNode } from '../src/core/schema-ir/gaussdb-policy-schema-node';
import { GaussDbRoleSchemaNode } from '../src/core/schema-ir/gaussdb-role-schema-node';
import { GaussDbTableSchemaNode } from '../src/core/schema-ir/gaussdb-table-schema-node';
import {
  GaussDbSchemaNodeKind,
  gaussdbDiffSubjectGranularity,
  gaussdbNodeGranularity,
} from '../src/core/schema-ir/schema-node-kinds';

/**
 * The subject granularity a GaussDB diff node's issues carry is resolved
 * from the node's `nodeKind` by the family/target map — NEVER stamped on the
 * node. Namespace/table nodes carry the granularities their extras classify
 * under (extraTopLevelObject, strict-gated); a policy node and a role node
 * are both `structural` (a policy set is owned by its managed table; a role
 * is referenced by the contract but not owned). The asymmetric grading for a
 * role — a missing declared one fails, an undeclared live one is tolerated
 * unconditionally — comes from roles resolving to the `external` control
 * policy, not from the granularity. These tests pin the map and prove the
 * node itself carries no role/granularity of its own.
 */
describe('gaussdbNodeGranularity map', () => {
  it.each([
    [GaussDbSchemaNodeKind.database, 'structural'],
    [GaussDbSchemaNodeKind.namespace, 'namespace'],
    [GaussDbSchemaNodeKind.table, 'entity'],
    [GaussDbSchemaNodeKind.policy, 'structural'],
    [GaussDbSchemaNodeKind.role, 'structural'],
  ] as const)('maps %s to %s', (nodeKind, granularity) => {
    expect(gaussdbNodeGranularity(nodeKind)).toBe(granularity);
  });
});

describe('gaussdbDiffSubjectGranularity dispatches GaussDB and relational kinds', () => {
  it('resolves a GaussDB-specific kind via the GaussDB map', () => {
    expect(gaussdbDiffSubjectGranularity(GaussDbSchemaNodeKind.policy)).toBe('structural');
    expect(gaussdbDiffSubjectGranularity(GaussDbSchemaNodeKind.table)).toBe('entity');
  });

  it('resolves a relational leaf kind via the relational map', () => {
    expect(gaussdbDiffSubjectGranularity('sql-column')).toBe('field');
    expect(gaussdbDiffSubjectGranularity('sql-index')).toBe('auxiliary');
  });
});

describe('GaussDB schema nodes carry no role/granularity of their own', () => {
  it.each([
    [
      'GaussDbDatabaseSchemaNode',
      new GaussDbDatabaseSchemaNode({
        namespaces: {},
        roles: [],
        existingSchemas: [],
        pgVersion: '',
      }),
    ],
    [
      'GaussDbNamespaceSchemaNode',
      new GaussDbNamespaceSchemaNode({
        schemaName: 'public',
        tables: {},
      }),
    ],
    [
      'GaussDbTableSchemaNode',
      new GaussDbTableSchemaNode({
        name: 't',
        columns: {},
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
    ],
    [
      'GaussDbPolicySchemaNode',
      new GaussDbPolicySchemaNode({
        naming: parseNaming('read_own_a1b2c3d4', 'read_own'),
        tableName: 'profiles',
        namespaceId: 'public',
        operation: 'select',
        roles: ['authenticated'],
        permissive: true,
        using: undefined,
        withCheck: undefined,
        dependsOn: undefined,
      }),
    ],
    [
      'GaussDbRoleSchemaNode',
      new GaussDbRoleSchemaNode({ name: 'authenticated', namespaceId: UNBOUND_NAMESPACE_ID }),
    ],
  ] as const)('%s exposes no diffRole or classification member of its own', (_label, node) => {
    expect('diffRole' in node).toBe(false);
    expect('nodeKind' in node).toBe(true);
  });
});

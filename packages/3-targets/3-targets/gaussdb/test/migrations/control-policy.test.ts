import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ControlPolicySubject, SuppressionRecord } from '@internal/family-sql/control';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { GaussDbSchema } from '../../src/core/gaussdb-schema';
import {
  renderGaussDbSuppression,
  resolveGaussDbNodeIssueControlPolicySubject,
} from '../../src/core/migrations/control-policy';
import { GaussDbNativeEnumSchemaNode } from '../../src/core/schema-ir/gaussdb-native-enum-schema-node';
import { GaussDbTableSchemaNode } from '../../src/core/schema-ir/gaussdb-table-schema-node';
import type { SqlSchemaDiffNode } from '../../src/core/schema-ir/schema-node-kinds';

/**
 * `resolveGaussDbNodeIssueControlPolicySubject` resolves a table and a
 * native enum through the SAME generic `gaussdbNodeStorageCoordinate`
 * branch — no per-kind (table vs enum) special-casing. These tests pin that
 * a create issue for each kind produces an identically-shaped subject
 * differing only in `entityKind`/`entityName`, and that a dropped
 * (`not-expected`) enum now resolves its subject namespace the same way a
 * dropped table always has: to `UNBOUND_NAMESPACE_ID`, since neither is
 * claimed by any contract namespace.
 */

const MEMBERS = ['draft', 'review', 'done'] as const;

function makeContract(): Contract<SqlStorage> {
  const schema = new GaussDbSchema({
    id: 'sales',
    entries: {
      table: {
        orders: new StorageTable({
          columns: { id: { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false } },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      native_enum: {
        order_status: {
          kind: 'gaussdb-enum',
          typeName: 'order_status',
          members: [...MEMBERS],
        },
      },
    },
  });
  return {
    target: 'gaussdb',
    targetFamily: 'sql',
    profileHash: profileHash('control-policy-subject-test'),
    defaultControlPolicy: 'managed',
    storage: new SqlStorage({
      storageHash: coreHash('control-policy-subject-test'),
      namespaces: { sales: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function tableNode(name: string): GaussDbTableSchemaNode {
  return new GaussDbTableSchemaNode({
    name,
    columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  });
}

function enumNode(typeName: string, members: readonly string[]): GaussDbNativeEnumSchemaNode {
  return new GaussDbNativeEnumSchemaNode({ typeName, namespaceId: 'sales', members });
}

describe('resolveGaussDbNodeIssueControlPolicySubject — generic entity coordinate', () => {
  const contract = makeContract();

  it('a table create issue and a native-enum create issue resolve the same shape, differing only in entityKind/entityName', () => {
    const tableIssue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'sales', 'orders'],
      expected: tableNode('orders'),
    };
    const enumIssue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'sales', 'native_enum:order_status'],
      expected: enumNode('order_status', MEMBERS),
    };

    expect(resolveGaussDbNodeIssueControlPolicySubject(tableIssue, contract)).toEqual({
      namespaceId: 'sales',
      entityKind: 'table',
      entityName: 'orders',
      createsNewObject: true,
    });
    expect(resolveGaussDbNodeIssueControlPolicySubject(enumIssue, contract)).toEqual({
      namespaceId: 'sales',
      entityKind: 'native_enum',
      entityName: 'order_status',
      createsNewObject: true,
    });
  });

  it('a dropped (not-expected) enum resolves namespaceId to UNBOUND, matching a dropped table', () => {
    const droppedEnumIssue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'sales', 'native_enum:stray_mood'],
      actual: enumNode('stray_mood', ['happy', 'sad']),
    };
    const droppedTableIssue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'sales', 'orphan'],
      actual: tableNode('orphan'),
    };

    // Enum drops now resolve like table drops: neither is claimed by any
    // contract namespace, so both fall back to UNBOUND_NAMESPACE_ID.
    expect(resolveGaussDbNodeIssueControlPolicySubject(droppedEnumIssue, contract)).toEqual({
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityKind: 'native_enum',
      entityName: 'stray_mood',
      createsNewObject: false,
    });
    expect(resolveGaussDbNodeIssueControlPolicySubject(droppedTableIssue, contract)).toEqual({
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityKind: 'table',
      entityName: 'orphan',
      createsNewObject: false,
    });
  });
});

/**
 * `renderGaussDbSuppression` renders the label purely off the subject's own
 * `(entityKind, entityName)` coordinate — there is no target-owned
 * table-vs-enum vocabulary and no `factoryName`-derived label.
 */
describe('renderGaussDbSuppression', () => {
  const contract = makeContract();

  const tableSubject: ControlPolicySubject = {
    namespaceId: 'sales',
    entityKind: 'table',
    entityName: 'orders',
    createsNewObject: true,
  };

  const enumSubject: ControlPolicySubject = {
    namespaceId: 'sales',
    entityKind: 'native_enum',
    entityName: 'order_status',
    createsNewObject: true,
  };

  it('a suppressed table creation names the table by coordinate and carries the creation factoryName', () => {
    const record: SuppressionRecord = {
      subject: tableSubject,
      policy: 'observed',
      factoryName: 'createTable',
      createsNewObject: true,
    };

    const conflict = renderGaussDbSuppression(record, contract);

    expect({ summary: conflict.summary, factoryName: conflict.meta?.['factoryName'] }).toEqual({
      summary:
        "control policy suppressed: table \"sales.orders\" — namespace 'sales' has effective control 'observed'",
      factoryName: 'createTable',
    });
  });

  it('a suppressed native-enum creation names the enum type, not a table', () => {
    const record: SuppressionRecord = {
      subject: enumSubject,
      policy: 'observed',
      factoryName: 'createNativeEnumType',
      createsNewObject: true,
    };

    const conflict = renderGaussDbSuppression(record, contract);

    expect({ summary: conflict.summary, factoryName: conflict.meta?.['factoryName'] }).toEqual({
      summary:
        "control policy suppressed: native_enum \"sales.order_status\" — namespace 'sales' has effective control 'observed'",
      factoryName: 'createNativeEnumType',
    });
  });

  it('a suppressed modification describes the subject by coordinate with no invented alter verb', () => {
    const record: SuppressionRecord = {
      subject: { ...enumSubject, createsNewObject: false },
      policy: 'tolerated',
      factoryName: undefined,
      createsNewObject: false,
    };

    const conflict = renderGaussDbSuppression(record, contract);

    expect(conflict.summary).toContain('native_enum "sales.order_status"');
    expect(conflict.summary).not.toMatch(/alterTable|alterType|alterSchema/);
    expect('factoryName' in (conflict.meta ?? {})).toBe(false);
  });

  it('an external namespace overriding a declared managed policy reports the declaration generically', () => {
    const record: SuppressionRecord = {
      subject: { ...enumSubject, explicitNodeControlPolicy: 'managed' },
      policy: 'external',
      factoryName: 'createNativeEnumType',
      createsNewObject: true,
    };

    const conflict = renderGaussDbSuppression(record, contract);

    expect(conflict.summary.endsWith("but declared 'managed'")).toBe(true);
    expect(conflict.summary).not.toContain('table');
  });
});

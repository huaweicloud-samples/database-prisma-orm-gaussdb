/**
 * Verify half of the managed/external grading matrix. Enablement drift is a
 * table `not-equal` issue and flows through the generic verdict as
 * `declaredIncompatible`, graded per the table's control policy: managed
 * fails, external suppresses. Policy drift (missing / extra / the two halves
 * of a rename) grades the same way. No verify plumbing exists for RLS —
 * everything here rides the generic diff verdict.
 */

import type { ControlPolicy } from '@internal/contract/types';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { verifySqlSchemaByDiff } from '@internal/family-sql/diff';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { namingOfLiveName, parseNaming } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { GaussDbRlsEnablement } from '../../src/core/gaussdb-rls-enablement';
import { GaussDbRlsPolicy } from '../../src/core/gaussdb-rls-policy';
import { GaussDbSchema } from '../../src/core/gaussdb-schema';
import { diffGaussDbSchema } from '../../src/core/migrations/diff-database-schema';
import { GaussDbDatabaseSchemaNode } from '../../src/core/schema-ir/gaussdb-database-schema-node';
import { GaussDbNamespaceSchemaNode } from '../../src/core/schema-ir/gaussdb-namespace-schema-node';
import { GaussDbPolicySchemaNode } from '../../src/core/schema-ir/gaussdb-policy-schema-node';
import { GaussDbTableSchemaNode } from '../../src/core/schema-ir/gaussdb-table-schema-node';
import { gaussdbDiffSubjectGranularity } from '../../src/core/schema-ir/schema-node-kinds';

const TABLE_NAME = 'profiles';

function policyNamed(name: string): GaussDbRlsPolicy {
  return new GaussDbRlsPolicy({
    naming: namingOfLiveName(name),
    tableName: TABLE_NAME,
    namespaceId: 'public',
    operation: 'select',
    roles: ['authenticated'],
    using: '(auth.uid() = user_id)',
    permissive: true,
    withCheck: undefined,
  });
}

function buildContract(options: {
  readonly marked: boolean;
  readonly policies?: readonly GaussDbRlsPolicy[];
  readonly control?: ControlPolicy;
}): Contract<SqlStorage> {
  const policyEntries: Record<string, GaussDbRlsPolicy> = {};
  for (const policy of options.policies ?? []) {
    policyEntries[policy.name] = policy;
  }
  const schema = new GaussDbSchema({
    id: 'public',
    entries: {
      table: {
        [TABLE_NAME]: new StorageTable({
          columns: {
            id: { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false },
            user_id: { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          ...(options.control !== undefined ? { control: options.control } : {}),
        }),
      },
      policy: policyEntries,
      rls: options.marked
        ? {
            [TABLE_NAME]: new GaussDbRlsEnablement({
              tableName: TABLE_NAME,
              namespaceId: 'public',
            }),
          }
        : {},
    },
  });
  return {
    target: 'gaussdb',
    targetFamily: 'sql',
    profileHash: profileHash('rls-verdict-matrix-test'),
    storage: new SqlStorage({
      storageHash: coreHash('rls-verdict-matrix-test'),
      namespaces: { public: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function actualSchema(options: {
  readonly rlsEnabled: boolean;
  readonly policies?: readonly GaussDbRlsPolicy[];
  readonly rlsStateObservable?: boolean;
}): GaussDbDatabaseSchemaNode {
  return new GaussDbDatabaseSchemaNode({
    namespaces: {
      public: new GaussDbNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          [TABLE_NAME]: new GaussDbTableSchemaNode({
            name: TABLE_NAME,
            columns: {
              id: { name: 'id', nativeType: 'int4', nullable: false },
              user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            rlsEnabled: options.rlsEnabled,
            policies: (options.policies ?? []).map(
              (policy) =>
                new GaussDbPolicySchemaNode({
                  naming: parseNaming(policy.name, policy.prefix),
                  tableName: policy.tableName,
                  namespaceId: 'public',
                  operation: policy.operation,
                  roles: [...policy.roles],
                  using: policy.using,
                  permissive: policy.permissive,
                  withCheck: undefined,
                  dependsOn: undefined,
                }),
            ),
          }),
        },
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
    ...(options.rlsStateObservable !== undefined
      ? { rlsStateObservable: options.rlsStateObservable }
      : {}),
  });
}

function verdictOk(contract: Contract<SqlStorage>, actual: GaussDbDatabaseSchemaNode): boolean {
  return verdict(contract, actual).ok;
}

function verdict(contract: Contract<SqlStorage>, actual: GaussDbDatabaseSchemaNode) {
  return verifySqlSchemaByDiff({
    contract,
    schema: actual,
    strict: true,
    frameworkComponents: [],
    diffSchema: diffGaussDbSchema,
    granularityOf: gaussdbDiffSubjectGranularity,
  });
}

describe('enablement drift verdicts', () => {
  it('managed: marker present but live RLS off fails verify', () => {
    const contract = buildContract({ marked: true });
    expect(verdictOk(contract, actualSchema({ rlsEnabled: false }))).toBe(false);
  });

  it('managed: no marker but live RLS on fails verify', () => {
    const contract = buildContract({ marked: false });
    expect(verdictOk(contract, actualSchema({ rlsEnabled: true }))).toBe(false);
  });

  it('managed: marker and live enablement in agreement verifies clean', () => {
    const contract = buildContract({ marked: true });
    expect(verdictOk(contract, actualSchema({ rlsEnabled: true }))).toBe(true);
  });

  it('external: enablement drift fails verify like any declared-shape divergence (plan still never emits ops)', () => {
    // The framework disposition deliberately fails existence/declared-shape
    // divergences on external subjects and suppresses only extras + value
    // drift — the same verdict an external table's column drift gets today.
    // The plan side is where external RLS is fully hands-off (the issue
    // partition suppresses enable/disable/create/drop/rename with a
    // warning; see rls-enablement-planner / rls-rename-planner).
    const unmarked = buildContract({ marked: false, control: 'external' });
    expect(verdictOk(unmarked, actualSchema({ rlsEnabled: true }))).toBe(false);
    const marked = buildContract({ marked: true, control: 'external' });
    expect(verdictOk(marked, actualSchema({ rlsEnabled: false }))).toBe(false);
  });

  it('last-policy removal end state (marker, RLS on, no policies) verifies clean', () => {
    const contract = buildContract({ marked: true });
    expect(verdictOk(contract, actualSchema({ rlsEnabled: true, policies: [] }))).toBe(true);
  });
});

describe('policy drift verdicts', () => {
  it('managed: a declared policy missing live fails verify', () => {
    const contract = buildContract({ marked: true, policies: [policyNamed('p_read_ab12cd34')] });
    expect(verdictOk(contract, actualSchema({ rlsEnabled: true }))).toBe(false);
  });

  it('managed: an undeclared live policy fails verify', () => {
    const contract = buildContract({ marked: true });
    expect(
      verdictOk(
        contract,
        actualSchema({ rlsEnabled: true, policies: [policyNamed('p_read_ab12cd34')] }),
      ),
    ).toBe(false);
  });

  it('managed: a rename in flight reports as missing + extra and fails verify', () => {
    const contract = buildContract({
      marked: true,
      policies: [policyNamed('owner_read_ab12cd34')],
    });
    expect(
      verdictOk(
        contract,
        actualSchema({ rlsEnabled: true, policies: [policyNamed('p_read_ab12cd34')] }),
      ),
    ).toBe(false);
  });

  it('external: an undeclared live policy suppresses (extraAuxiliary), but a declared-missing policy fails', () => {
    // Same disposition split as enablement drift: external suppresses
    // extras, and fails declared objects the database lacks — declaring a
    // policy on an external table asserts a shape the contract does not
    // manage, so verify holds it to the declaration.
    const extra = buildContract({ marked: true, control: 'external' });
    expect(
      verdictOk(
        extra,
        actualSchema({ rlsEnabled: true, policies: [policyNamed('p_read_ab12cd34')] }),
      ),
    ).toBe(true);

    const missing = buildContract({
      marked: true,
      policies: [policyNamed('p_read_ab12cd34')],
      control: 'external',
    });
    expect(verdictOk(missing, actualSchema({ rlsEnabled: true }))).toBe(false);

    // A rename in flight carries a declared-missing half, so it fails too.
    const renameInFlight = buildContract({
      marked: true,
      policies: [policyNamed('owner_read_ab12cd34')],
      control: 'external',
    });
    expect(
      verdictOk(
        renameInFlight,
        actualSchema({ rlsEnabled: true, policies: [policyNamed('p_read_ab12cd34')] }),
      ),
    ).toBe(false);
  });

  it('managed: matching policy set verifies clean', () => {
    const policy = policyNamed('p_read_ab12cd34');
    const contract = buildContract({ marked: true, policies: [policy] });
    expect(verdictOk(contract, actualSchema({ rlsEnabled: true, policies: [policy] }))).toBe(true);
  });
});

// ============================================================================
// Unobservable RLS state (GaussDB shape): the live server exposes neither
// pg_policies nor pg_class.relrowsecurity (live-probed 42P01/42703), so the
// introspected tree can never carry RLS state. Grading the resulting drift
// as a failure would make every RLS-bearing contract permanently
// unverifiable there — the S2-1 decision grades it 'observed' (warn) instead,
// while everything non-RLS keeps grading normally.
// ============================================================================

describe('unobservable RLS state verdicts (rlsStateObservable: false)', () => {
  it('managed: enablement drift warns instead of failing', () => {
    const contract = buildContract({ marked: true });
    const result = verdict(
      contract,
      actualSchema({ rlsEnabled: false, rlsStateObservable: false }),
    );
    expect(result.ok).toBe(true);
    expect(result.schema?.warnings?.issues.length ?? 0).toBeGreaterThan(0);
  });

  it('managed: a declared policy missing live warns instead of failing', () => {
    const contract = buildContract({ marked: true, policies: [policyNamed('p_read_ab12cd34')] });
    const result = verdict(contract, actualSchema({ rlsEnabled: true, rlsStateObservable: false }));
    expect(result.ok).toBe(true);
    expect(result.schema?.warnings?.issues.length ?? 0).toBeGreaterThan(0);
  });

  it('managed: non-RLS drift still fails on an unobservable-RLS root', () => {
    const contract = buildContract({ marked: true });
    // Column drift on the same table: the actual column type diverges from
    // the declared int4 — a fully observable difference that must keep
    // failing even though the RLS state is unobservable.
    const withColumnDrift = new GaussDbDatabaseSchemaNode({
      namespaces: {
        public: new GaussDbNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            [TABLE_NAME]: new GaussDbTableSchemaNode({
              name: TABLE_NAME,
              columns: {
                id: { name: 'id', nativeType: 'int8', nullable: false },
                user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              foreignKeys: [],
              uniques: [],
              indexes: [],
              rlsEnabled: false,
              policies: [],
            }),
          },
        }),
      },
      roles: [],
      existingSchemas: ['public'],
      pgVersion: 'unknown',
      rlsStateObservable: false,
    });
    const result = verdict(contract, withColumnDrift);
    expect(result.ok).toBe(false);
  });
});

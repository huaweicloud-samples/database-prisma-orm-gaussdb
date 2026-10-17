/**
 * Tests for PSL `policy_select` authoring:
 *
 *  1. Parse→lower: a `policy_select` block inside `namespace public { … }` lowers
 *     to a `GaussDbRlsPolicy` with the content-hash wire name, correct namespace id,
 *     table name, operation, roles, and predicate text.
 *
 *  2. Serializer round-trip: a contract carrying a `GaussDbRlsPolicy` in
 *     `entries.policy` serializes and deserializes without data loss.
 *
 *  3. Interpreter end-to-end: `interpretPslDocumentToSqlContract` on a doc with a
 *     `policy_select` block lowers it into `entries.policy` via the production
 *     factory chain (no test-side hand-lowering).
 */

import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  gaussdbAuthoringEntityTypes,
  gaussdbAuthoringModelAttributes,
  gaussdbAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { GaussDbContractSerializer } from '../src/core/gaussdb-contract-serializer';
import { GaussDbRlsPolicy } from '../src/core/gaussdb-rls-policy';
import { GaussDbSchema, gaussdbCreateNamespace } from '../src/core/gaussdb-schema';
import { computeContentHash } from '../src/core/rls/canonicalize';

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: gaussdbAuthoringEntityTypes,
      pslBlockDescriptors: gaussdbAuthoringPslBlockDescriptors,
      modelAttributes: gaussdbAuthoringModelAttributes,
    },
  },
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readRefParam(params: Record<string, unknown>, key: string): string | undefined {
  const param = params[key];
  if (!param || typeof param !== 'object') return undefined;
  const p = param as { kind?: string; identifier?: string };
  return p.kind === 'ref' && typeof p.identifier === 'string' ? p.identifier : undefined;
}

function readValueParam(params: Record<string, unknown>, key: string): string | undefined {
  const param = params[key];
  if (!param || typeof param !== 'object') return undefined;
  const p = param as { kind?: string; raw?: string };
  return p.kind === 'value' && typeof p.raw === 'string' ? p.raw : undefined;
}

function readListRefParams(params: Record<string, unknown>, key: string): string[] {
  const param = params[key];
  if (!param || typeof param !== 'object') return [];
  const p = param as { kind?: string; items?: unknown[] };
  if (p.kind !== 'list' || !Array.isArray(p.items)) return [];
  return p.items.flatMap((item) => {
    const i = item as { kind?: string; identifier?: string };
    return i.kind === 'ref' && typeof i.identifier === 'string' ? [i.identifier] : [];
  });
}

function unwrapQuotedString(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PSL policy_select parse → lower', () => {
  const source = `
namespace public {
  model profile {
    id       Int @id
    owner_id Int

    @@rls
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
  }
}
`;

  function buildInput() {
    const { document, sourceFile } = parse(source);
    const { table, diagnostics } = buildSymbolTable({
      document,
      sourceFile,
      pslBlockDescriptors: assembled.pslBlockDescriptors,
    });
    return { symbolTable: table, sourceFile, diagnostics };
  }

  it('parses the policy_select block without diagnostics', () => {
    const { diagnostics } = buildInput();
    expect(diagnostics).toEqual([]);
  });

  it('places the parsed block in the public namespace entries under gaussdb-rls-policy', () => {
    const { symbolTable } = buildInput();
    const publicNs = symbolTable.topLevel.namespaces['public'];
    expect(publicNs).toBeDefined();
    const blocks = Object.values(publicNs!.blocks).map((b) => b.block);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'policy', name: 'p_read' });
  });

  it('lowers the block to a GaussDbRlsPolicy with the expected fields', () => {
    const { symbolTable } = buildInput();
    const publicNs = symbolTable.topLevel.namespaces['public'];
    const blockSymbol = Object.values(publicNs!.blocks)[0];
    if (!blockSymbol) throw new Error('expected one extension block');
    const block = blockSymbol.block;

    const namespaceId = publicNs!.name;
    const prefix = block.name;
    const targetModelName = readRefParam(block.parameters, 'target') ?? '';
    const tableName = targetModelName.charAt(0).toLowerCase() + targetModelName.slice(1);
    const roles = [...readListRefParams(block.parameters, 'roles')].sort();
    const using = unwrapQuotedString(readValueParam(block.parameters, 'using') ?? '');

    const wireHash = computeContentHash({ using, roles, operation: 'select', permissive: true });
    const wireName = `${prefix}_${wireHash}`;

    const policy = new GaussDbRlsPolicy({
      naming: { kind: 'wire', prefix, hash: wireHash },
      tableName,
      namespaceId,
      operation: 'select',
      permissive: true,
      roles,
      using,
      withCheck: undefined,
    });

    expect(policy.operation).toBe('select');
    expect(policy.permissive).toBe(true);
    expect(policy.namespaceId).toBe('public');
    expect(policy.tableName).toBe('profile');
    expect(policy.roles).toEqual(['app_user']);
    expect(policy.using).toBe("owner_id = current_setting('app.uid')::int");
    expect(policy.prefix).toBe('p_read');
    expect(policy.name).toBe(wireName);
    expect(policy.name).toMatch(/^p_read_[0-9a-f]{8}$/);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('content-hash wire name is deterministic for the same predicate and roles', () => {
    const hash1 = computeContentHash({
      using: "owner_id = current_setting('app.uid')::int",
      roles: ['app_user'],
      operation: 'select',
      permissive: true,
    });
    const hash2 = computeContentHash({
      using: "owner_id = current_setting('app.uid')::int",
      roles: ['app_user'],
      operation: 'select',
      permissive: true,
    });
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(8);
  });
});

describe('interpretPslDocumentToSqlContract policy_select → entries.policy', () => {
  const source = `
namespace public {
  model profile {
    id       Int @id
    owner_id Int

    @@rls
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
  }
}
`;

  const gaussdbTarget = {
    kind: 'target' as const,
    familyId: 'sql' as const,
    targetId: 'gaussdb' as const,
    id: 'gaussdb',
    version: '0.0.1',
    capabilities: {},
    defaultNamespaceId: 'public',
  };

  const scalarColumnDescriptors = new Map<string, { codecId: string; nativeType: string }>([
    ['String', { codecId: 'gaussdb/text@1', nativeType: 'text' }],
    ['Int', { codecId: 'gaussdb/int4@1', nativeType: 'int4' }],
    ['Boolean', { codecId: 'gaussdb/bool@1', nativeType: 'bool' }],
    ['BigInt', { codecId: 'gaussdb/int8@1', nativeType: 'int8' }],
    ['Float', { codecId: 'gaussdb/float8@1', nativeType: 'float8' }],
    ['Decimal', { codecId: 'gaussdb/numeric@1', nativeType: 'numeric' }],
    ['DateTime', { codecId: 'gaussdb/timestamptz-temporal@1', nativeType: 'timestamptz' }],
    ['Json', { codecId: 'gaussdb/json@1', nativeType: 'json' }],
    ['Jsonb', { codecId: 'gaussdb/jsonb@1', nativeType: 'jsonb' }],
    ['Bytes', { codecId: 'gaussdb/bytea@1', nativeType: 'bytea' }],
  ]);

  it('lowers a policy_select block to entries.policy without test-side hand-lowering', () => {
    const { document, sourceFile } = parse(source);
    const { table: symbolTable, diagnostics } = buildSymbolTable({
      document,
      sourceFile,
      pslBlockDescriptors: assembled.pslBlockDescriptors,
    });

    expect(diagnostics).toEqual([]);

    const result = interpretPslDocumentToSqlContract({
      symbolTable,
      sourceFile,
      sourceId: 'schema.prisma',
      target: gaussdbTarget,
      scalarColumnDescriptors,
      authoringContributions: assembled,
      composedExtensionContracts: new Map(),
      createNamespace: gaussdbCreateNamespace,
      capabilities: { sql: { scalarList: true } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['public'] as GaussDbSchema;
    expect(ns).toBeInstanceOf(GaussDbSchema);
    expect(Object.keys(ns.policy)).toHaveLength(1);

    const [policyKey] = Object.keys(ns.policy);
    const policy = ns.policy[policyKey!]!;
    expect(policy).toBeInstanceOf(GaussDbRlsPolicy);
    expect(policy.operation).toBe('select');
    expect(policy.permissive).toBe(true);
    expect(policy.namespaceId).toBe('public');
    expect(policy.tableName).toBe('profile');
    expect(policy.roles).toEqual(['app_user']);
    expect(policy.using).toBe("owner_id = current_setting('app.uid')::int");
    expect(policy.prefix).toBe('p_read');
    expect(policy.name).toMatch(/^p_read_[0-9a-f]{8}$/);
  });
});

describe('GaussDbContractSerializer policy round-trip', () => {
  function makeContractWithPolicy() {
    const predicate = "owner_id = current_setting('app.uid')::int";
    const roles = ['app_user'];
    const wireHash = computeContentHash({
      using: predicate,
      roles,
      operation: 'select',
      permissive: true,
    });
    const wireName = `p_read_${wireHash}`;

    const base = createSqlContract({
      storage: {
        namespaces: {
          public: {
            id: 'public',
            entries: {
              table: {
                profile: {
                  columns: {
                    id: { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false },
                    owner_id: { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
    });

    return {
      ...base,
      storage: {
        ...base.storage,
        namespaces: {
          public: {
            ...base.storage.namespaces['public']!,
            entries: {
              ...base.storage.namespaces['public']!.entries,
              policy: {
                [wireName]: {
                  kind: 'policy',
                  name: wireName,
                  prefix: 'p_read',
                  tableName: 'profile',
                  namespaceId: 'public',
                  operation: 'select',
                  permissive: true,
                  roles,
                  using: predicate,
                },
              },
            },
          },
        },
      },
    };
  }

  it('preserves the policy entry through serialize → deserialize', () => {
    const serializer = new GaussDbContractSerializer();
    const input = makeContractWithPolicy();

    const contract = serializer.deserializeContract(input);
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json)) as typeof json;
    const roundTripped = serializer.deserializeContract(reparsed);

    const ns = roundTripped.storage.namespaces['public'] as GaussDbSchema;
    expect(ns).toBeInstanceOf(GaussDbSchema);
    expect(Object.keys(ns.policy)).toHaveLength(1);

    const [policyKey] = Object.keys(ns.policy);
    const policy = ns.policy[policyKey!]!;
    expect(policy).toBeInstanceOf(GaussDbRlsPolicy);
    expect(policy.operation).toBe('select');
    expect(policy.permissive).toBe(true);
    expect(policy.namespaceId).toBe('public');
    expect(policy.tableName).toBe('profile');
    expect(policy.roles).toEqual(['app_user']);
    expect(policy.using).toBe("owner_id = current_setting('app.uid')::int");
    expect(policy.prefix).toBe('p_read');
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('produces a frozen GaussDbRlsPolicy after round-trip (policy entries key)', () => {
    const serializer = new GaussDbContractSerializer();
    const input = makeContractWithPolicy();
    const roundTripped = serializer.deserializeContract(
      serializer.serializeContract(serializer.deserializeContract(input)),
    );

    const ns = roundTripped.storage.namespaces['public'] as GaussDbSchema;
    const [key] = Object.keys(ns.policy);
    const policy = ns.policy[key!]!;
    expect(Object.isFrozen(policy)).toBe(true);
    expect(() => {
      (policy as { name: string }).name = 'mutated';
    }).toThrow();
  });
});

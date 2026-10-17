/**
 * `role` block authoring end-to-end in the GaussDB target:
 *
 *  1. `role anon {}` declared inside `namespace unbound { … }` parses and
 *     lowers to a `GaussDbRole` in the contract's `__unbound__` storage
 *     slot, entity coordinate `__unbound__` (roles are cluster-scoped in
 *     GaussDB and belong to no schema).
 *  2. A `role` block anywhere else — inside a named namespace, or at the
 *     document top level — is rejected by the gaussdb lowering with
 *     `PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE`.
 *  3. The lowered entity round-trips through the gaussdb contract
 *     serializer (serialize → deserialize) without collapsing the unbound
 *     slot to `GaussDbSchema.unbound`.
 */

import type { Contract } from '@internal/contract/types';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { describe, expect, it } from 'vitest';
import {
  gaussdbAuthoringEntityTypes,
  gaussdbAuthoringModelAttributes,
  gaussdbAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { GaussDbContractSerializer } from '../src/core/gaussdb-contract-serializer';
import { GaussDbRole } from '../src/core/gaussdb-role';
import { GaussDbSchema, gaussdbCreateNamespace } from '../src/core/gaussdb-schema';

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: gaussdbAuthoringEntityTypes,
      pslBlockDescriptors: gaussdbAuthoringPslBlockDescriptors,
      modelAttributes: gaussdbAuthoringModelAttributes,
    },
  },
]);

const gaussdbTarget = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'gaussdb' as const,
  id: 'gaussdb',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
};

const scalarTypeDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['String', { codecId: 'gaussdb/text@1', nativeType: 'text' }],
  ['Int', { codecId: 'gaussdb/int4@1', nativeType: 'int4' }],
]);

function interpret(source: string) {
  const { document, sourceFile } = parse(source);
  const { table: symbolTable, diagnostics } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  expect(diagnostics).toEqual([]);

  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    target: gaussdbTarget,
    scalarColumnDescriptors: scalarTypeDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: gaussdbCreateNamespace,
    capabilities: { sql: { scalarList: true } },
  });
}

describe('`role` block authoring inside `namespace unbound`', () => {
  it('lowers into the unbound storage slot with the unbound entity coordinate', () => {
    const result = interpret(`
namespace unbound {
  role anon {
  }
}

model Profile {
  id Int @id
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const unbound = result.value.storage.namespaces[UNBOUND_NAMESPACE_ID] as GaussDbSchema;
    expect(unbound).toBeInstanceOf(GaussDbSchema);
    expect(unbound.role['anon']).toBeInstanceOf(GaussDbRole);
    expect(unbound.role['anon']).toMatchObject({
      kind: 'role',
      name: 'anon',
      namespaceId: UNBOUND_NAMESPACE_ID,
      control: 'external',
    });
  });

  it('lowers every declared role block independently', () => {
    const result = interpret(`
namespace unbound {
  role anon {
  }

  role authenticated {
  }

  role service_role {
  }
}

model Profile {
  id Int @id
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const unbound = result.value.storage.namespaces[UNBOUND_NAMESPACE_ID] as GaussDbSchema;
    expect(Object.keys(unbound.role).sort()).toEqual(['anon', 'authenticated', 'service_role']);
  });

  it('round-trips through the contract serializer without collapsing to GaussDbSchema.unbound', () => {
    const result = interpret(`
namespace unbound {
  role anon {
  }
}

model Profile {
  id Int @id
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serializer = new GaussDbContractSerializer();
    const interpreted = result.value as Contract<SqlStorage>;
    const json = serializer.serializeContract(interpreted);
    const deserialized = serializer.deserializeContract(json);
    const unbound = deserialized.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(unbound).not.toBe(GaussDbSchema.unbound);
    expect((unbound as GaussDbSchema).role['anon']).toMatchObject({
      kind: 'role',
      name: 'anon',
      namespaceId: UNBOUND_NAMESPACE_ID,
    });
  });

  it('rejects a role block declared inside a named namespace', () => {
    const result = interpret(`
namespace auth {
  model Profile {
    id Int @id
  }

  role anon {
  }
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE',
          message:
            '`role` block "anon" must be declared inside `namespace unbound { }`, not in namespace "auth"',
        }),
      ]),
    );
  });

  it('rejects a role block declared at the document top level', () => {
    const result = interpret(`
role anon {
}

model Profile {
  id Int @id
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE',
          message:
            '`role` block "anon" must be declared inside `namespace unbound { }`, not in namespace "public"',
        }),
      ]),
    );
  });
});

import type { TargetPackRef } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  GaussDbSchema,
  GaussDbUnboundSchema,
  gaussdbCreateNamespace,
} from '@internal/target-gaussdb/types';
import { describe, expect, it } from 'vitest';

const gaussdbTargetPackRef: TargetPackRef<'sql', 'gaussdb'> = {
  kind: 'target',
  id: 'gaussdb',
  familyId: 'sql',
  targetId: 'gaussdb',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const gaussdbScalarTypeDescriptors = new Map([
  ['Int', { codecId: 'gaussdb/int4@1', nativeType: 'int4' }],
] as const);

function symbolTableInput(schema: string) {
  const { document, sourceFile } = parse(schema);
  const { table } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: {},
  });
  return { symbolTable: table, sourceFile, sourceId: 'schema.prisma' };
}

/**
 * End-to-end demonstration that the FR15 slice-3 + FR16a wiring lines
 * up: a PSL document goes through the SQL PSL interpreter; the
 * GaussDB `createNamespace` factory threads target-specific
 * `Namespace` concretions into `SqlStorage.namespaces`; and looking up
 * a model's `namespaceId` in that map yields the right qualifier
 * behaviour for DDL emission (`GaussDbUnboundSchema` elides;
 * `GaussDbSchema(id)` qualifies).
 *
 * Renders the namespace abstraction the planned AC6 PGlite integration
 * test relies on. The planner-side rewire (replacing
 * `qualifyTableName(ctx.schemaName, X)` with
 * `namespace.qualifyTable(X)` across ~28 DDL/check call sites in
 * `core/migrations/`) is the natural slice for a follow-on round; this
 * round closes the contract-side substrate so the planner refactor
 * has stable pre-resolved namespaces to consume.
 */
describe('PSL → SqlStorage.namespaces qualifier routing (FR15 slice 3 + FR16a end-to-end)', () => {
  // The qualifier hook is active: `createNamespace` now produces
  // target-specific concretions (GaussDbUnboundSchema / GaussDbSchema)
  // that carry the assembled tables and dispatch qualifyTable correctly.
  it('`namespace unbound { … }` lowers to GaussDbUnboundSchema, whose qualifyTable elides the schema prefix', () => {
    const document = symbolTableInput(`namespace unbound {
  model Tenant {
    id Int @id
  }
}
`);

    const result = interpretPslDocumentToSqlContract({
      ...document,
      target: gaussdbTargetPackRef,
      scalarColumnDescriptors: gaussdbScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: gaussdbCreateNamespace,
      capabilities: { sql: { scalarList: true } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const storage = result.value.storage as SqlStorage;
    expect(storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries.table?.['tenant']).toBeDefined();

    // The storage map carries the GaussDB target concretion (not the
    // SQL family placeholder) at the unbound slot.
    const namespace = storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(namespace).toBeInstanceOf(GaussDbUnboundSchema);

    // The qualifier elides — DDL emission against this namespace
    // produces unqualified output that `search_path` resolves at
    // runtime.
    if (!(namespace instanceof GaussDbSchema)) {
      throw new Error('expected GaussDbSchema concretion');
    }
    expect(namespace.qualifyTable('tenant')).toBe('"tenant"');
  });

  it('`namespace auth { … }` lowers to GaussDbSchema("auth"), whose qualifyTable emits `"auth"."<table>"`', () => {
    const document = symbolTableInput(`namespace auth {
  model User {
    id Int @id
  }
}
`);

    const result = interpretPslDocumentToSqlContract({
      ...document,
      target: gaussdbTargetPackRef,
      scalarColumnDescriptors: gaussdbScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: gaussdbCreateNamespace,
      capabilities: { sql: { scalarList: true } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const storage = result.value.storage as SqlStorage;
    expect(storage.namespaces['auth']!.entries.table?.['user']).toBeDefined();

    const namespace = storage.namespaces['auth'];
    expect(namespace).toBeInstanceOf(GaussDbSchema);
    expect(namespace).not.toBeInstanceOf(GaussDbUnboundSchema);
    if (!(namespace instanceof GaussDbSchema)) {
      throw new Error('expected GaussDbSchema concretion');
    }
    expect(namespace.qualifyTable('user')).toBe('"auth"."user"');
  });

  it('top-level (implicit) models lower to the public namespace with schema-qualified DDL', () => {
    const document = symbolTableInput(`model Post {
  id Int @id
}
`);

    const result = interpretPslDocumentToSqlContract({
      ...document,
      target: gaussdbTargetPackRef,
      scalarColumnDescriptors: gaussdbScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: gaussdbCreateNamespace,
      capabilities: { sql: { scalarList: true } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const storage = result.value.storage as SqlStorage;
    expect(storage.namespaces['public']!.entries.table?.['post']).toBeDefined();

    const namespace = storage.namespaces['public'];
    expect(namespace).toBeInstanceOf(GaussDbSchema);
    expect(namespace).not.toBeInstanceOf(GaussDbUnboundSchema);
    if (!(namespace instanceof GaussDbSchema)) {
      throw new Error('expected GaussDbSchema concretion');
    }
    expect(namespace.qualifyTable('post')).toBe('"public"."post"');
  });
});

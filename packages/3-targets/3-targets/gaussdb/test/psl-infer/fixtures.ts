import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import { printPsl } from '@internal/psl-printer';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { gaussdbAuthoringPslBlockDescriptors } from '../../src/core/authoring';
import { inferGaussDbPslContract } from '../../src/core/psl-infer/infer-psl-contract';
import { GaussDbDatabaseSchemaNode } from '../../src/core/schema-ir/gaussdb-database-schema-node';
import { GaussDbNamespaceSchemaNode } from '../../src/core/schema-ir/gaussdb-namespace-schema-node';
import { GaussDbNativeEnumSchemaNode } from '../../src/core/schema-ir/gaussdb-native-enum-schema-node';
import { GaussDbTableSchemaNode } from '../../src/core/schema-ir/gaussdb-table-schema-node';

/**
 * Wraps a flat `{ tables, annotations? }` introspection fixture into the
 * `GaussDbDatabaseSchemaNode` tree the target's inference walks. The flat
 * `annotations.pg.nativeEnums` (`{ typeName, values }` entries) becomes the
 * namespace's `nativeEnums` (one `GaussDbNativeEnumSchemaNode` per entry).
 * All fixture tables live under the single `public` namespace (`contract
 * infer` introspects one live schema).
 */
export function treeFromFlat(schemaIR: SqlSchemaIR): GaussDbDatabaseSchemaNode {
  const enums = readNativeEnums(schemaIR.annotations).map(
    (entry) =>
      new GaussDbNativeEnumSchemaNode({
        typeName: entry.typeName,
        namespaceId: 'public',
        members: entry.values,
      }),
  );
  const tables: Record<string, GaussDbTableSchemaNode> = {};
  for (const [name, table] of Object.entries(schemaIR.tables)) {
    tables[name] = new GaussDbTableSchemaNode({
      name: table.name,
      columns: table.columns,
      foreignKeys: table.foreignKeys,
      uniques: table.uniques,
      indexes: table.indexes,
      ...(table.primaryKey !== undefined ? { primaryKey: table.primaryKey } : {}),
      ...(table.annotations !== undefined ? { annotations: table.annotations } : {}),
      ...(table.checks !== undefined ? { checks: table.checks } : {}),
      rlsEnabled: false,
    });
  }
  return new GaussDbDatabaseSchemaNode({
    namespaces: {
      public: new GaussDbNamespaceSchemaNode({
        schemaName: 'public',
        tables,
        nativeEnums: enums,
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: '',
  });
}

/** Infers and prints PSL from a flat introspection fixture. */
export function printPslFromFlat(schemaIR: SqlSchemaIR): string {
  return printPsl(inferGaussDbPslContract(treeFromFlat(schemaIR)), {
    pslBlockDescriptors: gaussdbAuthoringPslBlockDescriptors,
  });
}

/** Infers a PSL AST from a flat introspection fixture. */
export function inferPslAstFromFlat(schemaIR: SqlSchemaIR): PslDocumentAst {
  return inferGaussDbPslContract(treeFromFlat(schemaIR));
}

function readPgAnnotationArray(
  annotations: SqlSchemaIR['annotations'],
  key: string,
): unknown[] | undefined {
  const pg = annotations?.['pg'];
  const value = pg && typeof pg === 'object' ? (pg as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) ? value : undefined;
}

interface FlatNativeEnumEntry {
  readonly typeName: string;
  readonly values: readonly string[];
}

function readNativeEnums(annotations: SqlSchemaIR['annotations']): readonly FlatNativeEnumEntry[] {
  const entries = readPgAnnotationArray(annotations, 'nativeEnums') ?? [];
  return entries.filter((entry): entry is FlatNativeEnumEntry => {
    if (typeof entry !== 'object' || entry === null) return false;
    const { typeName, values } = entry as { typeName?: unknown; values?: unknown };
    return (
      typeof typeName === 'string' &&
      Array.isArray(values) &&
      values.every((v): v is string => typeof v === 'string')
    );
  });
}

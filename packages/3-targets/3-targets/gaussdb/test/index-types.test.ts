import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  gaussdbAuthoringEntityTypes,
  gaussdbAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { gaussdbTargetDescriptorMeta } from '../src/core/descriptor-meta';
import { type GaussDbSchema, gaussdbCreateNamespace } from '../src/core/gaussdb-schema';
import { gaussdbIndexTypes } from '../src/core/index-types';

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: gaussdbAuthoringEntityTypes,
      pslBlockDescriptors: gaussdbAuthoringPslBlockDescriptors,
      type: {
        Int: { kind: 'typeConstructor', output: { codecId: 'gaussdb/int4@1', nativeType: 'int4' } },
      },
    },
  },
]);

const scalarTypeDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['Int', { codecId: 'gaussdb/int4@1', nativeType: 'int4' }],
]);

function interpret(source: string) {
  const { document, sourceFile } = parse(source);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    capabilities: {},
    target: gaussdbTargetDescriptorMeta,
    scalarColumnDescriptors: scalarTypeDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: gaussdbCreateNamespace,
  });
}

function modelWithIndexType(indexType: string): string {
  return `
model Widgets {
  id   Int @id
  code Int
  @@index([code], type: "${indexType}")
}
`;
}

describe('gaussdbIndexTypes', () => {
  it('registers the six GaussDB built-in access methods', () => {
    expect(gaussdbIndexTypes.entries.map((e) => e.type)).toEqual([
      'btree',
      'hash',
      'gin',
      'gist',
      'spgist',
      'brin',
    ]);
  });

  it('accepts an arbitrary options object for every registered method (permissive; per-method validation is a later slice)', () => {
    for (const entry of gaussdbIndexTypes.entries) {
      const result = entry.options({ anything: 'goes' });
      expect(result instanceof type.errors).toBe(false);
    }
  });
});

describe('gaussdbTargetDescriptorMeta', () => {
  it('declares its index types via gaussdbIndexTypes', () => {
    expect(gaussdbTargetDescriptorMeta.indexTypes).toBe(gaussdbIndexTypes);
  });
});

describe('contract build registers gaussdb index types end-to-end', () => {
  it('accepts @@index(..., type: "gin")', () => {
    const result = interpret(modelWithIndexType('gin'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = result.value.storage.namespaces['public'] as GaussDbSchema;
    expect(ns.table['widgets']?.indexes.map((idx) => idx.type)).toEqual(['gin']);
  });

  it('accepts @@index(..., type: "hash")', () => {
    const result = interpret(modelWithIndexType('hash'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = result.value.storage.namespaces['public'] as GaussDbSchema;
    expect(ns.table['widgets']?.indexes.map((idx) => idx.type)).toEqual(['hash']);
  });

  it('still rejects a bogus, unregistered index type — registering real methods does not disable the check', () => {
    expect(() => interpret(modelWithIndexType('bogus'))).toThrow(/unregistered index type "bogus"/);
  });
});

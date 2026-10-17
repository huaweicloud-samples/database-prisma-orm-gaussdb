/**
 * Index op factories lower structured DDL nodes — the ops carry
 * `GaussDbCreateIndex` / `GaussDbAlterIndexRename` / `GaussDbDropIndex`
 * through the lowerer instead of hand-concatenated SQL (the byte-level
 * rendering is asserted beside the renderer in the adapter package).
 */
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  GaussDbAlterIndexRename,
  GaussDbCreateIndex,
  GaussDbDropIndex,
} from '../../src/core/ddl/nodes';
import { createIndex, dropIndex, renameIndex } from '../../src/core/migrations/operations/indexes';

function recordingLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    lowerToExecuteRequest: async (ast) => {
      received.push(ast);
      return Object.freeze({
        sql: `LOWERED ${received.length}`,
        params: Object.freeze([`p${received.length}`]),
      });
    },
  };
  return { lowerer, received };
}

describe('createIndex lowers a GaussDbCreateIndex node', () => {
  it('carries schema, table, name, and column elements', async () => {
    const { lowerer, received } = recordingLowerer();
    await createIndex('public', 'user', 'user_email_idx', { columns: ['email'] }, lowerer);
    const node = received.find((n) => n instanceof GaussDbCreateIndex) as GaussDbCreateIndex;
    expect(node).toBeDefined();
    expect(node.schema).toBe('public');
    expect(node.table).toBe('user');
    expect(node.name).toBe('user_email_idx');
    expect(node.unique).toBe(false);
    expect(node.elements).toEqual({ columns: ['email'] });
    expect(node.type).toBeUndefined();
    expect(node.options).toBeUndefined();
    expect(node.where).toBeUndefined();
  });

  it('carries unique, type, options, where, and an expression element list verbatim', async () => {
    const { lowerer, received } = recordingLowerer();
    await createIndex(
      'public',
      'doc',
      'doc_email_eq',
      { expression: 'lower(email), id' },
      lowerer,
      {
        unique: true,
        type: 'btree',
        options: { fillfactor: 70 },
        where: 'deleted_at IS NULL',
      },
    );
    const node = received.find((n) => n instanceof GaussDbCreateIndex) as GaussDbCreateIndex;
    expect(node.unique).toBe(true);
    expect(node.type).toBe('btree');
    expect(node.options).toEqual({ fillfactor: 70 });
    expect(node.where).toBe('deleted_at IS NULL');
    expect(node.elements).toEqual({ expression: 'lower(email), id' });
  });

  it('lowers the unbound namespace as an absent schema (unqualified DDL)', async () => {
    const { lowerer, received } = recordingLowerer();
    await createIndex(
      UNBOUND_NAMESPACE_ID,
      'user',
      'user_email_idx',
      { columns: ['email'] },
      lowerer,
    );
    const node = received.find((n) => n instanceof GaussDbCreateIndex) as GaussDbCreateIndex;
    expect(node.schema).toBeUndefined();
  });

  it('shapes the op: additive class, checks around the lowered execute', async () => {
    const { lowerer } = recordingLowerer();
    const op = await createIndex(
      'public',
      'user',
      'user_email_idx',
      { columns: ['email'] },
      lowerer,
    );
    expect(op.id).toBe('index.user.user_email_idx');
    expect(op.operationClass).toBe('additive');
    expect(op.precheck).toHaveLength(1);
    expect(op.execute).toHaveLength(1);
    expect(op.postcheck).toHaveLength(1);
  });
});

describe('renameIndex lowers a GaussDbAlterIndexRename node', () => {
  it('carries schema, from, and to; the op is widening', async () => {
    const { lowerer, received } = recordingLowerer();
    const op = await renameIndex(
      'public',
      'user',
      'old_email_idx',
      'user_email_idx_46df9cad',
      lowerer,
    );
    const node = received.find(
      (n) => n instanceof GaussDbAlterIndexRename,
    ) as GaussDbAlterIndexRename;
    expect(node).toBeDefined();
    expect(node.schema).toBe('public');
    expect(node.from).toBe('old_email_idx');
    expect(node.to).toBe('user_email_idx_46df9cad');
    expect(op.operationClass).toBe('widening');
    expect(op.id).toBe('index.public.user.old_email_idx.rename');
    expect(op.precheck).toHaveLength(2);
    expect(op.postcheck).toHaveLength(1);
  });
});

describe('dropIndex lowers a GaussDbDropIndex node', () => {
  it('carries schema and name; the op is destructive', async () => {
    const { lowerer, received } = recordingLowerer();
    const op = await dropIndex('public', 'user', 'user_email_idx', lowerer);
    const node = received.find((n) => n instanceof GaussDbDropIndex) as GaussDbDropIndex;
    expect(node).toBeDefined();
    expect(node.schema).toBe('public');
    expect(node.name).toBe('user_email_idx');
    expect(op.operationClass).toBe('destructive');
    expect(op.id).toBe('dropIndex.user.user_email_idx');
  });
});

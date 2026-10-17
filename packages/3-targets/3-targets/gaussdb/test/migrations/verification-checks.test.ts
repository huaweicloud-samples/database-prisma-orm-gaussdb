import type {
  AndExpr,
  BinaryExpr,
  ExistsExpr,
  NullCheckExpr,
  OperationExpr,
  ParamRef,
  RawExpr,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  columnExistsAst,
  columnNullabilityAst,
  columnTypeAst,
  constraintExistsAst,
  extensionExistsAst,
  indexExistsAst,
  noNullValuesAst,
  tableExistsAst,
  tableIsEmptyAst,
  tablePrimaryKeyAst,
} from '../../src/contract-free/checks';
import type { GaussDbTableSource } from '../../src/core/ast/table-source';

const PG_CLASS_OID_TEMPLATE =
  '(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = {{self}} AND c.relname = {{arg0}} LIMIT 1)';

describe('tableExistsAst — pg_class oid check builder (GaussDB lacks to_regclass)', () => {
  describe('tableAbsent()', () => {
    it('returns a FROM-less SelectAst projecting the pg_class oid subquery IS NULL', () => {
      const ast = tableExistsAst('public', 'users').tableAbsent();
      expect(ast.kind).toBe('select');
      expect(ast.from).toBeUndefined();
      expect(ast.projection).toHaveLength(1);

      const proj = ast.projection[0]!;
      expect(proj.alias).toBe('result');
      expect(proj.codec).toBeUndefined();

      const nullCheck = proj.expr as NullCheckExpr;
      expect(nullCheck.kind).toBe('null-check');
      expect(nullCheck.isNull).toBe(true);

      const opExpr = nullCheck.expr as OperationExpr;
      expect(opExpr.kind).toBe('operation');
      expect(opExpr.lowering.strategy).toBe('function');
      expect(opExpr.lowering.template).toBe(PG_CLASS_OID_TEMPLATE);

      const selfParam = opExpr.self as ParamRef;
      expect(selfParam.kind).toBe('param-ref');
      expect(selfParam.codec?.codecId).toBe('gaussdb/text@1');
      expect(selfParam.value).toBe('public');

      const nameArg = opExpr.args?.[0];
      expect(nameArg?.kind).toBe('param-ref');
      expect((nameArg as ParamRef).value).toBe('users');
    });

    it('collects the schema and table-name param refs', () => {
      const ast = tableExistsAst('public', 'users').tableAbsent();
      const refs = ast.collectParamRefs();
      expect(refs).toHaveLength(2);
      expect((refs[0] as ParamRef).value).toBe('public');
      expect((refs[1] as ParamRef).value).toBe('users');
    });
  });

  describe('tablePresent()', () => {
    it('returns a FROM-less SelectAst projecting the pg_class oid subquery IS NOT NULL', () => {
      const ast = tableExistsAst('public', 'users').tablePresent();
      const nullCheck = ast.projection[0]!.expr as NullCheckExpr;
      expect(nullCheck.isNull).toBe(false);
    });

    it('matches current_schema() for the unbound namespace instead of a bound param', () => {
      const ast = tableExistsAst('__unbound__', 'users').tableAbsent();
      const opExpr = (ast.projection[0]!.expr as NullCheckExpr).expr as OperationExpr;
      const raw = opExpr.self as RawExpr;
      expect(raw.kind).toBe('raw-expr');
      expect(raw.parts).toEqual(['current_schema()']);
      const nameArg = opExpr.args?.[0];
      expect((nameArg as ParamRef).value).toBe('users');
    });
  });
});

describe('constraintExistsAst — pg_constraint EXISTS check builder', () => {
  describe('constraintPresent()', () => {
    it('projects EXISTS over pg_constraint JOIN pg_namespace with bound params', () => {
      const ast = constraintExistsAst({
        constraintName: 'user_pkey',
        schema: 'public',
        table: 'user',
      }).constraintPresent();

      expect(ast.kind).toBe('select');
      expect(ast.from).toBeUndefined();
      expect(ast.projection).toHaveLength(1);
      const proj = ast.projection[0]!;
      expect(proj.alias).toBe('result');
      expect(proj.codec).toBeUndefined();

      const exists = proj.expr as ExistsExpr;
      expect(exists.kind).toBe('exists');
      expect(exists.notExists).toBe(false);

      const inner = exists.subquery;
      expect((inner.from as TableSource).name).toBe('pg_constraint');
      expect((inner.from as TableSource).alias).toBe('c');
      expect(inner.joins).toHaveLength(1);
      const join = inner.joins?.[0];
      expect(join?.joinType).toBe('inner');
      expect((join!.source as TableSource).name).toBe('pg_namespace');
      expect((join!.source as TableSource).alias).toBe('n');

      const where = inner.where as AndExpr;
      expect(where.kind).toBe('and');
      expect(where.exprs).toHaveLength(3);

      const conname = where.exprs[0] as BinaryExpr;
      expect((conname.right as ParamRef).value).toBe('user_pkey');
      expect((conname.right as ParamRef).codec?.codecId).toBe('gaussdb/text@1');

      const nspname = where.exprs[1] as BinaryExpr;
      expect((nspname.right as ParamRef).value).toBe('public');

      const conrelid = where.exprs[2] as BinaryExpr;
      const oidSubquery = conrelid.right as OperationExpr;
      expect(oidSubquery.kind).toBe('operation');
      expect(oidSubquery.lowering.template).toBe(PG_CLASS_OID_TEMPLATE);
      expect((oidSubquery.self as ParamRef).value).toBe('public');
      const oidNameArg = oidSubquery.args?.[0];
      expect((oidNameArg as ParamRef).value).toBe('user');
    });

    it('omits the conrelid filter when table is not given', () => {
      const ast = constraintExistsAst({
        constraintName: 'user_pkey',
        schema: 'public',
      }).constraintPresent();
      const exists = ast.projection[0]!.expr as ExistsExpr;
      const where = exists.subquery.where as AndExpr;
      expect(where.exprs).toHaveLength(2);
    });

    it('uses current_schema() for the unbound namespace instead of a bound param', () => {
      const ast = constraintExistsAst({
        constraintName: 'user_pkey',
        schema: '__unbound__',
      }).constraintPresent();
      const exists = ast.projection[0]!.expr as ExistsExpr;
      const where = exists.subquery.where as AndExpr;
      const nspname = where.exprs[1] as BinaryExpr;
      const raw = nspname.right as RawExpr;
      expect(raw.kind).toBe('raw-expr');
      expect(raw.parts).toEqual(['current_schema()']);
    });

    it('collects params in template order: conname, nspname, oid-schema, oid-name', () => {
      const ast = constraintExistsAst({
        constraintName: 'user_pkey',
        schema: 'public',
        table: 'user',
      }).constraintPresent();
      const values = ast.collectParamRefs().map((ref) => (ref as ParamRef).value);
      expect(values).toEqual(['user_pkey', 'public', 'public', 'user']);
    });
  });

  describe('constraintAbsent()', () => {
    it('uses NOT EXISTS over the same body', () => {
      const ast = constraintExistsAst({
        constraintName: 'user_pkey',
        schema: 'public',
        table: 'user',
      }).constraintAbsent();
      const exists = ast.projection[0]!.expr as ExistsExpr;
      expect(exists.kind).toBe('exists');
      expect(exists.notExists).toBe(true);
      expect((exists.subquery.from as TableSource).name).toBe('pg_constraint');
    });
  });
});

describe('D3 catalog check builders — construction pins', () => {
  it('columnExistsAst binds all three names as gaussdb/text@1 params over information_schema.columns', () => {
    const ast = columnExistsAst({
      schema: 'public',
      table: 'user',
      column: 'email',
    }).columnPresent();
    expect(ast.from).toBeUndefined();
    const exists = ast.projection[0]!.expr as ExistsExpr;
    expect(exists.kind).toBe('exists');
    expect(exists.notExists).toBe(false);
    const from = exists.subquery.from as GaussDbTableSource;
    expect(from.schema).toBe('information_schema');
    expect(from.name).toBe('columns');
    const refs = ast.collectParamRefs() as readonly ParamRef[];
    expect(refs.map((ref) => ref.value)).toEqual(['public', 'user', 'email']);
    for (const ref of refs) {
      expect(ref.codec?.codecId).toBe('gaussdb/text@1');
    }
  });

  it('columnNullabilityAst binds the YES/NO marker as a param, not a literal', () => {
    const ast = columnNullabilityAst({
      schema: 'public',
      table: 'user',
      column: 'email',
      nullable: false,
    });
    const values = ast.collectParamRefs().map((ref) => (ref as ParamRef).value);
    expect(values).toEqual(['public', 'user', 'email', 'NO']);
  });

  it('columnTypeAst carries format_type as an OperationExpr from cfExpr.fn', () => {
    const ast = columnTypeAst({
      schema: 'public',
      table: 'user',
      column: 'age',
      expectedType: 'integer',
    });
    const exists = ast.projection[0]!.expr as ExistsExpr;
    const where = exists.subquery.where as AndExpr;
    const typeCond = where.exprs[3] as BinaryExpr;
    const formatType = typeCond.left as OperationExpr;
    expect(formatType.kind).toBe('operation');
    expect(formatType.method).toBe('format_type');
    expect(formatType.lowering.template).toBe('format_type({{self}}, {{arg0}})');
    expect((typeCond.right as ParamRef).value).toBe('integer');
    expect(where.exprs[4]?.kind).toBe('not');
  });

  it('tablePrimaryKeyAst uses a LEFT JOIN for the constraint-name scope', () => {
    const ast = tablePrimaryKeyAst({
      schema: 'public',
      table: 'user',
      constraintName: 'user_pkey',
    }).pkPresent();
    const exists = ast.projection[0]!.expr as ExistsExpr;
    expect(exists.subquery.joins?.map((join) => join.joinType)).toEqual(['inner', 'inner', 'left']);
    const values = ast.collectParamRefs().map((ref) => (ref as ParamRef).value);
    expect(values).toEqual(['public', 'user', 'user_pkey']);
  });

  it('tableIsEmptyAst targets the schema-qualified user table with LIMIT 1', () => {
    const ast = tableIsEmptyAst('public', 'user');
    const exists = ast.projection[0]!.expr as ExistsExpr;
    expect(exists.notExists).toBe(true);
    const from = exists.subquery.from as GaussDbTableSource;
    expect(from.schema).toBe('public');
    expect(from.name).toBe('user');
    expect(exists.subquery.limit).toBe(1);
  });

  it('tableIsEmptyAst leaves the unbound table unqualified', () => {
    const ast = tableIsEmptyAst('__unbound__', 'user');
    const from = (ast.projection[0]!.expr as ExistsExpr).subquery.from as GaussDbTableSource;
    expect(from.schema).toBeUndefined();
    expect(from.name).toBe('user');
  });

  it('extensionExistsAst binds the extension name as a gaussdb/text@1 param', () => {
    const extAst = extensionExistsAst('vector').extensionPresent();
    const extRef = extAst.collectParamRefs()[0] as ParamRef;
    expect(extRef.value).toBe('vector');
    expect(extRef.codec?.codecId).toBe('gaussdb/text@1');
  });

  it('indexExistsAst rides pgClassOid with the schema and index name as separate params', () => {
    const ast = indexExistsAst('public', 'user_email_idx').indexAbsent();
    const nullCheck = ast.projection[0]!.expr as NullCheckExpr;
    expect(nullCheck.isNull).toBe(true);
    const op = nullCheck.expr as OperationExpr;
    expect(op.lowering.template).toBe(PG_CLASS_OID_TEMPLATE);
    expect((op.self as ParamRef).value).toBe('public');
    const nameArg = op.args?.[0];
    expect((nameArg as ParamRef).value).toBe('user_email_idx');
  });

  it('noNullValuesAst projects NOT EXISTS over the user table', () => {
    const ast = noNullValuesAst({ schema: 'public', table: 'user', column: 'email' });
    const exists = ast.projection[0]!.expr as ExistsExpr;
    expect(exists.notExists).toBe(true);
    expect(exists.subquery.where?.kind).toBe('null-check');
  });
});

// Rendered-SQL lowering coverage lives in the adapter package
// (packages/3-targets/6-adapters/gaussdb/test/verification-checks-lowering.test.ts):
// the adapter depends on this target package, never the reverse.

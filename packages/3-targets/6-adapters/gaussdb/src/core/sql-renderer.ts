import type { JsonValue } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import { runtimeError } from '@internal/framework-components/runtime';
import {
  type AggregateExpr,
  type AnyExpression,
  type AnyFromSource,
  type AnyJsonValueProjection,
  type AnyParamRef,
  type AnyQueryAst,
  type BinaryExpr,
  type CaseExpr,
  type CastExpr,
  type ColumnRef,
  collectOrderedParamRefs,
  type DeleteAst,
  type FunctionCallExpr,
  type InsertAst,
  type InsertValue,
  type JoinAst,
  type JoinOnExpr,
  type JsonArrayAggExpr,
  type JsonObjectExpr,
  type JsonValueProjectionVisitor,
  type ListExpression,
  LiteralExpr,
  type LoweredParam,
  type NullCheckExpr,
  type OperationExpr,
  type OrderByItem,
  type ProjectionExpr,
  type ProjectionItem,
  type RawExpr,
  type RawQueryAst,
  type SelectAst,
  type SubqueryExpr,
  type TableSource,
  type UpdateAst,
  type WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import type { GaussDbCodecDescriptorRegistry } from '@internal/target-gaussdb/codec-descriptor';
import { isPgEnumParams } from '@internal/target-gaussdb/codecs';
import {
  escapeLiteral,
  quoteIdentifier,
  quoteQualifiedName,
} from '@internal/target-gaussdb/sql-utils';
import { ifDefined } from '@internal/utils/defined';
import { assertNever, InternalError } from '@internal/utils/internal-error';
import { adapterError } from './adapter-errors';
import type { GaussDbContract, StorageTable } from './types';

/**
 * GaussDB native types whose unknown-OID parameter inference is reliable in arbitrary expression positions. Parameters bound to a descriptor whose `nativeTypeFor` result falls in this set are emitted as plain `$N`; everything else (including `json`, `jsonb`, extension types like `vector`, and unknown user types) is emitted as `$N::<nativeType>` so the planner picks an unambiguous overload.
 *
 * `json` / `jsonb` are intentionally excluded despite being GaussDB builtins: their operator overloads make context inference unreliable in expression positions (e.g. `$1 -> 'key'` is ambiguous between the two).
 *
 * Spellings match the target descriptors' `nativeTypeFor` results, not the `udt_name` abbreviations that ADR 205 used as illustrative shorthand. The registry-based cast policy compares against these strings directly.
 */
const GAUSSDB_INFERRABLE_NATIVE_TYPES: ReadonlySet<string> = new Set([
  // Numeric
  'integer',
  'smallint',
  'bigint',
  'real',
  'double precision',
  'numeric',
  // Boolean
  'boolean',
  // Strings
  'text',
  'character',
  'character varying',
  // Temporal
  'timestamp',
  'timestamp without time zone',
  'timestamp with time zone',
  'time',
  'timetz',
  'interval',
  // Bit strings
  'bit',
  'bit varying',
]);

function renderTypedParam(
  index: number,
  codecId: string | undefined,
  codecDescriptorRegistry: GaussDbCodecDescriptorRegistry,
  many?: boolean,
  typeParams?: JsonValue,
): string {
  if (codecId === undefined) {
    return `$${index}`;
  }
  const descriptor = codecDescriptorRegistry.descriptorFor(codecId);
  if (descriptor === undefined) {
    throw adapterError(
      'RUNTIME.PARAM_REF_MISSING_CODEC',
      `GaussDB lowering: ParamRef carries codecId "${codecId}" but the ` +
        'validated GaussDB codec registry has no entry for it. This usually indicates ' +
        'a missing extension pack in the runtime stack — register the pack ' +
        'that contributes this codec (e.g. `extensions: [pgvectorRuntime]`), ' +
        'or use the codec directly from `@internal/target-gaussdb/codecs` ' +
        "if it's a builtin.",
      { meta: { codecId } },
    );
  }
  const ref: CodecRef = {
    codecId,
    ...ifDefined('many', many),
    ...ifDefined('typeParams', typeParams),
  };
  const nativeType = descriptor.nativeTypeFor(ref);
  const arraySuffix = many ? '[]' : '';
  if (isPgEnumParams(typeParams)) {
    return `$${index}::${quoteQualifiedName(nativeType)}${arraySuffix}`;
  }
  if (!GAUSSDB_INFERRABLE_NATIVE_TYPES.has(nativeType) || many) {
    return `$${index}::${nativeType}${arraySuffix}`;
  }
  return `$${index}`;
}

function unreachableKind(value: never): string {
  const candidate: unknown = value;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    'kind' in candidate &&
    typeof candidate.kind === 'string'
  ) {
    return candidate.kind;
  }
  return 'unknown';
}

/**
 * Per-render carrier threaded through every helper. Bundles the param-index map (for `$N` numbering) and the assembled-stack target descriptor registry (for cast policy at the `renderTypedParam` chokepoint). Carrying both on a single value keeps helper signatures stable.
 */
interface ParamIndexMap {
  readonly indexMap: Map<AnyParamRef, number>;
  readonly codecDescriptorRegistry: GaussDbCodecDescriptorRegistry;
}

/**
 * Render a SQL query AST to a GaussDb-flavored `{ sql, params }` payload.
 *
 * Shared between the runtime (`GaussDbAdapterImpl.lower`) and control (`GaussDbControlAdapter.lower`) entrypoints so emit-time and run-time paths produce byte-identical output for the same AST.
 */
export function renderLoweredSql(
  ast: AnyQueryAst,
  contract: GaussDbContract,
  codecDescriptorRegistry: GaussDbCodecDescriptorRegistry,
): { readonly sql: string; readonly params: readonly LoweredParam[] } {
  const orderedRefs = collectOrderedParamRefs(ast);
  const indexMap = new Map<AnyParamRef, number>();
  const params: LoweredParam[] = orderedRefs.map((ref, i) => {
    indexMap.set(ref, i + 1);
    return ref.kind === 'prepared-param-ref'
      ? { kind: 'bind', name: ref.name }
      : { kind: 'literal', value: ref.value };
  });
  const pim: ParamIndexMap = { indexMap, codecDescriptorRegistry };

  const node = ast;
  let sql: string;
  switch (node.kind) {
    case 'select':
      sql = renderSelect(node, contract, pim);
      break;
    case 'insert':
      sql = renderInsert(node, contract, pim);
      break;
    case 'update':
      sql = renderUpdate(node, contract, pim);
      break;
    case 'delete':
      sql = renderDelete(node, contract, pim);
      break;
    case 'raw-query':
      sql = renderParts(node.parts, contract, pim);
      break;
    // v8 ignore next 4
    default:
      assertNever(node, `Unsupported AST node kind: ${unreachableKind(node)}`);
  }

  return Object.freeze({ sql, params: Object.freeze(params) });
}

function renderLimitOffset(
  keyword: 'LIMIT' | 'OFFSET',
  value: SelectAst['limit'] | SelectAst['offset'],
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  if (value === undefined) return '';
  if (typeof value === 'number') return `${keyword} ${value}`;
  return `${keyword} ${renderExpr(value, contract, pim)}`;
}

function renderSelect(ast: SelectAst, contract: GaussDbContract, pim: ParamIndexMap): string {
  const selectClause = `SELECT ${renderDistinctPrefix(ast.distinct, ast.distinctOn, contract, pim)}${renderProjection(
    ast.projection,
    contract,
    pim,
  )}`;
  const fromClause = ast.from !== undefined ? `FROM ${renderSource(ast.from, contract, pim)}` : '';

  const joinsClause = ast.joins?.length
    ? ast.joins.map((join) => renderJoin(join, contract, pim)).join(' ')
    : '';

  const whereClause = ast.where ? `WHERE ${renderWhere(ast.where, contract, pim)}` : '';
  const groupByClause = ast.groupBy?.length
    ? `GROUP BY ${ast.groupBy.map((expr) => renderExpr(expr, contract, pim)).join(', ')}`
    : '';
  const havingClause = ast.having ? `HAVING ${renderWhere(ast.having, contract, pim)}` : '';
  const orderClause = ast.orderBy?.length
    ? `ORDER BY ${ast.orderBy
        .map((order) => {
          const expr = renderExpr(order.expr, contract, pim);
          return `${expr} ${order.dir.toUpperCase()}`;
        })
        .join(', ')}`
    : '';
  const limitClause = renderLimitOffset('LIMIT', ast.limit, contract, pim);
  const offsetClause = renderLimitOffset('OFFSET', ast.offset, contract, pim);

  const clauses = [
    selectClause,
    fromClause,
    joinsClause,
    whereClause,
    groupByClause,
    havingClause,
    orderClause,
    limitClause,
    offsetClause,
  ]
    .filter((part) => part.length > 0)
    .join(' ');
  return clauses.trim();
}

function renderProjection(
  projection: ReadonlyArray<ProjectionItem>,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  return projection
    .map((item) => {
      const alias = quoteIdentifier(item.alias);
      if (item.expr.kind === 'literal') {
        return `${renderLiteral(item.expr)} AS ${alias}`;
      }
      return `${renderExpr(item.expr, contract, pim)} AS ${alias}`;
    })
    .join(', ');
}

function renderReturning(
  items: ReadonlyArray<ProjectionItem>,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  return items
    .map((item) => {
      if (item.expr.kind === 'column-ref') {
        const rendered = renderColumn(item.expr);
        return item.expr.column === item.alias
          ? rendered
          : `${rendered} AS ${quoteIdentifier(item.alias)}`;
      }
      if (item.expr.kind === 'literal') {
        return `${renderLiteral(item.expr)} AS ${quoteIdentifier(item.alias)}`;
      }
      return `${renderExpr(item.expr, contract, pim)} AS ${quoteIdentifier(item.alias)}`;
    })
    .join(', ');
}

function renderDistinctPrefix(
  distinct: true | undefined,
  distinctOn: ReadonlyArray<AnyExpression> | undefined,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  if (distinctOn && distinctOn.length > 0) {
    const rendered = distinctOn.map((expr) => renderExpr(expr, contract, pim)).join(', ');
    return `DISTINCT ON (${rendered}) `;
  }
  if (distinct) {
    return 'DISTINCT ';
  }
  return '';
}

function hasExplicitSchema(
  table: Pick<TableSource, 'name' | 'namespaceId'>,
): table is Pick<TableSource, 'name' | 'namespaceId'> & { readonly schema: string } {
  return 'schema' in table && typeof table.schema === 'string';
}

function qualifyTableFromNamespaceCoordinate(
  table: Pick<TableSource, 'name' | 'namespaceId'>,
  contract: GaussDbContract,
): string {
  if (hasExplicitSchema(table)) {
    return `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
  }
  if (table.namespaceId === undefined) {
    return quoteIdentifier(table.name);
  }
  const namespace = contract.storage.namespaces[table.namespaceId];
  if (namespace === undefined) {
    throw adapterError(
      'RUNTIME.NAMESPACE_UNKNOWN',
      `Table "${table.name}" references namespace "${table.namespaceId}" which is not present as a GaussDB schema on the contract`,
      { meta: { table: table.name, namespaceId: table.namespaceId, reason: 'not-present' } },
    );
  }
  const qualifyTable = namespace.qualifyTable;
  if (qualifyTable === undefined) {
    throw adapterError(
      'RUNTIME.NAMESPACE_UNKNOWN',
      `Table "${table.name}" references namespace "${table.namespaceId}" which is not materialised as a GaussDB schema on the contract`,
      { meta: { table: table.name, namespaceId: table.namespaceId, reason: 'not-materialised' } },
    );
  }
  return qualifyTable.call(namespace, table.name);
}

function renderTableSource(source: TableSource, contract: GaussDbContract): string {
  const qualified = qualifyTableFromNamespaceCoordinate(source, contract);
  if (!source.alias) {
    return qualified;
  }
  return `${qualified} AS ${quoteIdentifier(source.alias)}`;
}

function renderSource(
  source: AnyFromSource,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  const node = source;
  switch (node.kind) {
    case 'table-source':
      return renderTableSource(node, contract);
    case 'derived-table-source':
      return `(${renderSelect(node.query, contract, pim)}) AS ${quoteIdentifier(node.alias)}`;
    case 'function-source': {
      const args = node.args.map((arg) => renderExpr(arg, contract, pim)).join(', ');
      const call = `${node.fn}(${args})`;
      const ordinality = node.ordinality ? ' WITH ORDINALITY' : '';
      const alias = node.alias === undefined ? '' : ` AS ${quoteIdentifier(node.alias)}`;
      const columnAliases =
        node.columnAliases === undefined
          ? ''
          : `(${node.columnAliases.map((column) => quoteIdentifier(column)).join(', ')})`;
      return `${call}${ordinality}${alias}${columnAliases}`;
    }
    // v8 ignore next 4
    default:
      assertNever(node, `Unsupported source node kind: ${unreachableKind(node)}`);
  }
}

function assertScalarSubquery(query: SelectAst): void {
  if (query.projection.length !== 1) {
    throw adapterError(
      'RUNTIME.AST_INVALID',
      'Subquery expressions must project exactly one column',
      { meta: { node: 'subquery-expr' } },
    );
  }
}

function renderSubqueryExpr(
  expr: SubqueryExpr,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  assertScalarSubquery(expr.query);
  return `(${renderSelect(expr.query, contract, pim)})`;
}

function renderWhere(expr: AnyExpression, contract: GaussDbContract, pim: ParamIndexMap): string {
  return renderExpr(expr, contract, pim);
}

function renderNullCheck(
  expr: NullCheckExpr,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  const rendered = renderExpr(expr.expr, contract, pim);
  const renderedExpr = isAtomicExpressionKind(expr.expr.kind) ? rendered : `(${rendered})`;
  return expr.isNull ? `${renderedExpr} IS NULL` : `${renderedExpr} IS NOT NULL`;
}

/**
 * Atomic expression kinds whose rendered SQL is already self-delimited (a column reference, parameter, literal, function call, aggregate, etc.) and therefore does not need surrounding parentheses when used as the left operand of a postfix predicate like `IS NULL` or `IS NOT NULL`, or as either operand of a binary infix operator.
 *
 * Anything not in this set is treated as composite (binary, AND/OR/NOT, EXISTS, nested IS NULL, subqueries, operation templates) and gets wrapped to preserve grouping.
 */
function isAtomicExpressionKind(kind: AnyExpression['kind']): boolean {
  switch (kind) {
    case 'column-ref':
    case 'identifier-ref':
    case 'param-ref':
    case 'prepared-param-ref':
    case 'literal':
    case 'aggregate':
    case 'window-func':
    case 'function-call':
    case 'cast':
    case 'case':
    case 'json-object':
    case 'json-array-agg':
    case 'list':
      return true;
    case 'subquery':
    case 'operation':
    case 'binary':
    case 'and':
    case 'or':
    case 'exists':
    case 'null-check':
    case 'not':
    case 'raw-expr':
      return false;
  }
}

function renderBinary(expr: BinaryExpr, contract: GaussDbContract, pim: ParamIndexMap): string {
  if (expr.right.kind === 'list' && expr.right.values.length === 0) {
    if (expr.op === 'in') {
      return 'FALSE';
    }
    if (expr.op === 'notIn') {
      return 'TRUE';
    }
  }

  const leftExpr = expr.left;
  const left = renderExpr(leftExpr, contract, pim);
  const leftRendered =
    leftExpr.kind === 'operation' || leftExpr.kind === 'subquery' ? `(${left})` : left;

  const rightNode = expr.right;
  let right: string;
  switch (rightNode.kind) {
    case 'list':
      right = renderListLiteral(rightNode, contract, pim);
      break;
    case 'literal':
      right = renderLiteral(rightNode);
      break;
    case 'column-ref':
      right = renderColumn(rightNode);
      break;
    case 'param-ref':
    case 'prepared-param-ref':
      right = renderParamRef(rightNode, pim);
      break;
    default:
      right = renderExpr(rightNode, contract, pim);
      break;
  }

  const operatorMap: Record<BinaryExpr['op'], string> = {
    eq: '=',
    neq: '!=',
    gt: '>',
    lt: '<',
    gte: '>=',
    lte: '<=',
    like: 'LIKE',
    in: 'IN',
    notIn: 'NOT IN',
  };

  return `${leftRendered} ${operatorMap[expr.op]} ${right}`;
}

function renderListLiteral(
  expr: ListExpression,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  if (expr.values.length === 0) {
    return '(NULL)';
  }
  const values = expr.values
    .map((v) => {
      if (v.kind === 'param-ref' || v.kind === 'prepared-param-ref') {
        return renderParamRef(v, pim);
      }
      if (v.kind === 'literal') return renderLiteral(v);
      return renderExpr(v, contract, pim);
    })
    .join(', ');
  return `(${values})`;
}

function renderColumn(ref: ColumnRef): string {
  if (ref.table === 'excluded') {
    return `excluded.${quoteIdentifier(ref.column)}`;
  }
  return `${quoteIdentifier(ref.table)}.${quoteIdentifier(ref.column)}`;
}

function renderAggregateExpr(
  expr: AggregateExpr,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  const fn = expr.fn.toUpperCase();
  if (!expr.expr) {
    return `${fn}(*)`;
  }
  return `${fn}(${renderExpr(expr.expr, contract, pim)})`;
}

function renderWindowFuncExpr(
  expr: WindowFuncExpr,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  const fn = expr.fn.toUpperCase();
  const args = expr.args.map((arg) => renderExpr(arg, contract, pim)).join(', ');
  const partitionClause =
    expr.partitionBy && expr.partitionBy.length > 0
      ? `PARTITION BY ${expr.partitionBy.map((e) => renderExpr(e, contract, pim)).join(', ')}`
      : '';
  const orderClause =
    expr.orderBy && expr.orderBy.length > 0
      ? `ORDER BY ${renderOrderByItems(expr.orderBy, contract, pim)}`
      : '';
  const over = [partitionClause, orderClause].filter((part) => part.length > 0).join(' ');
  return `${fn}(${args}) OVER (${over})`;
}

function renderFunctionCallExpr(
  expr: FunctionCallExpr,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  const args = expr.args.map((arg) => renderExpr(arg, contract, pim)).join(', ');
  return `${expr.fn}(${args})`;
}

function renderCastExpr(expr: CastExpr, contract: GaussDbContract, pim: ParamIndexMap): string {
  return `CAST(${renderExpr(expr.expr, contract, pim)} AS ${expr.targetType})`;
}

function renderCaseExpr(expr: CaseExpr, contract: GaussDbContract, pim: ParamIndexMap): string {
  const branches = expr.branches
    .map(
      (branch) =>
        `WHEN ${renderExpr(branch.condition, contract, pim)} THEN ${renderExpr(branch.value, contract, pim)}`,
    )
    .join(' ');
  const elseClause =
    expr.elseExpr === undefined ? '' : ` ELSE ${renderExpr(expr.elseExpr, contract, pim)}`;
  return `CASE ${branches}${elseClause} END`;
}

function renderJsonValueProjection(
  projection: AnyJsonValueProjection,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  const visitor: JsonValueProjectionVisitor<string> = {
    // The codec's descriptor owns the expression that turns a stored value
    // into its canonical JSON — a cast, a function call, or the array lift,
    // chosen on `ref.many` inside `projectJson`.
    codec: ({ value, codec }) =>
      renderExpr(projectJsonThroughCodec(value, codec, pim), contract, pim),
    native: ({ value }) => renderExpr(value, contract, pim),
    // GaussDB carries a JSON value's type with it, so a document nested
    // into an enclosing document stays a document without help.
    document: ({ value }) => renderExpr(value, contract, pim),
  };
  return projection.accept(visitor);
}

function projectJsonThroughCodec(
  value: ProjectionExpr,
  codec: CodecRef,
  pim: ParamIndexMap,
): ProjectionExpr {
  const descriptor = pim.codecDescriptorRegistry.descriptorFor(codec.codecId);
  if (descriptor === undefined) {
    throw adapterError(
      'RUNTIME.PARAM_REF_MISSING_CODEC',
      `GaussDB lowering: a JSON projection carries codecId "${codec.codecId}" but the ` +
        'validated GaussDB codec registry has no entry for it. This usually indicates ' +
        'a missing extension pack in the runtime stack — register the pack ' +
        'that contributes this codec (e.g. `extensions: [pgvectorRuntime]`), ' +
        'or use the codec directly from `@internal/target-gaussdb/codecs` ' +
        "if it's a builtin.",
      { meta: { codecId: codec.codecId } },
    );
  }
  return descriptor.projectJson(value, codec);
}

function renderJsonObjectExpr(
  expr: JsonObjectExpr,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  const args = expr.entries
    .flatMap((entry): [string, string] => {
      const key = `'${escapeLiteral(entry.key)}'`;
      return [key, renderJsonValueProjection(entry.value, contract, pim)];
    })
    .join(', ');
  return `json_build_object(${args})`;
}

function renderOrderByItems(
  items: ReadonlyArray<OrderByItem>,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  return items
    .map((item) => `${renderExpr(item.expr, contract, pim)} ${item.dir.toUpperCase()}`)
    .join(', ');
}

function renderJsonArrayAggExpr(
  expr: JsonArrayAggExpr,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  const aggregateOrderBy =
    expr.orderBy && expr.orderBy.length > 0
      ? ` ORDER BY ${renderOrderByItems(expr.orderBy, contract, pim)}`
      : '';
  const aggregated = `json_agg(${renderJsonValueProjection(expr.expr, contract, pim)}${aggregateOrderBy})`;
  if (expr.onEmpty === 'emptyArray') {
    return `coalesce(${aggregated}, json_build_array())`;
  }
  return aggregated;
}

function renderExpr(expr: AnyExpression, contract: GaussDbContract, pim: ParamIndexMap): string {
  const node = expr;
  switch (node.kind) {
    case 'column-ref':
      return renderColumn(node);
    case 'identifier-ref':
      return quoteIdentifier(node.name);
    case 'operation':
      return renderOperation(node, contract, pim);
    case 'subquery':
      return renderSubqueryExpr(node, contract, pim);
    case 'aggregate':
      return renderAggregateExpr(node, contract, pim);
    case 'window-func':
      return renderWindowFuncExpr(node, contract, pim);
    case 'function-call':
      return renderFunctionCallExpr(node, contract, pim);
    case 'cast':
      return renderCastExpr(node, contract, pim);
    case 'case':
      return renderCaseExpr(node, contract, pim);
    case 'json-object':
      return renderJsonObjectExpr(node, contract, pim);
    case 'json-array-agg':
      return renderJsonArrayAggExpr(node, contract, pim);
    case 'binary':
      return renderBinary(node, contract, pim);
    case 'and':
      if (node.exprs.length === 0) {
        return 'TRUE';
      }
      return `(${node.exprs.map((part) => renderExpr(part, contract, pim)).join(' AND ')})`;
    case 'or':
      if (node.exprs.length === 0) {
        return 'FALSE';
      }
      return `(${node.exprs.map((part) => renderExpr(part, contract, pim)).join(' OR ')})`;
    case 'exists': {
      const notKeyword = node.notExists ? 'NOT ' : '';
      const subquery = renderSelect(node.subquery, contract, pim);
      return `${notKeyword}EXISTS (${subquery})`;
    }
    case 'null-check':
      return renderNullCheck(node, contract, pim);
    case 'not':
      return `NOT (${renderExpr(node.expr, contract, pim)})`;
    case 'param-ref':
    case 'prepared-param-ref':
      return renderParamRef(node, pim);
    case 'literal':
      return renderLiteral(node);
    case 'list':
      return renderListLiteral(node, contract, pim);
    case 'raw-expr':
      return renderRawExpr(node, contract, pim);
    // v8 ignore next 4
    default:
      assertNever(node, `Unsupported expression node kind: ${unreachableKind(node)}`);
  }
}

function renderParamRef(ref: AnyParamRef, pim: ParamIndexMap): string {
  const index = pim.indexMap.get(ref);
  if (index === undefined) {
    throw new InternalError('ParamRef not found in index map');
  }
  if (ref.kind === 'prepared-param-ref') {
    return renderTypedParam(
      index,
      ref.codec.codecId,
      pim.codecDescriptorRegistry,
      ref.codec.many,
      ref.codec.typeParams,
    );
  }
  if (ref.codec === undefined) {
    throw runtimeError(
      'RUNTIME.PARAM_REF_MISSING_CODEC',
      'GaussDB renderer: ParamRef reached lowering without a bound CodecRef. ' +
        'Every column-bound ParamRef must carry a codec under the AST-bound codec contract. ' +
        'This usually indicates a builder path that constructed a ParamRef without threading the column codec.',
      { paramIndex: index, ...ifDefined('name', ref.name) },
    );
  }
  return renderTypedParam(
    index,
    ref.codec.codecId,
    pim.codecDescriptorRegistry,
    ref.codec.many,
    ref.codec.typeParams,
  );
}

function renderLiteral(expr: LiteralExpr): string {
  if (typeof expr.value === 'string') {
    return `'${escapeLiteral(expr.value)}'`;
  }
  if (typeof expr.value === 'number' || typeof expr.value === 'boolean') {
    return String(expr.value);
  }
  if (typeof expr.value === 'bigint') {
    return String(expr.value);
  }
  if (expr.value === null) {
    return 'NULL';
  }
  if (expr.value === undefined) {
    return 'NULL';
  }
  if (expr.value instanceof Date) {
    return `'${escapeLiteral(expr.value.toISOString())}'`;
  }
  if (Array.isArray(expr.value)) {
    return `ARRAY[${expr.value.map((v: unknown) => renderLiteral(new LiteralExpr(v))).join(', ')}]`;
  }
  const json = JSON.stringify(expr.value);
  if (json === undefined) {
    return 'NULL';
  }
  return `'${escapeLiteral(json)}'`;
}

function renderOperation(
  expr: OperationExpr,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  const self = renderExpr(expr.self, contract, pim);
  const args = expr.args.map((arg) => {
    return renderExpr(arg, contract, pim);
  });

  // Resolve `{{self}}` and `{{argN}}` from the original template in a single pass. Doing this with sequential `String.prototype.replace` calls is unsafe: a substituted fragment can itself contain text that matches a later token (e.g. an arg literal containing the substring `{{arg1}}`), and the next iteration would corrupt it. A single regex callback never re-scans already-substituted output.
  return expr.lowering.template.replace(
    /\{\{self\}\}|\{\{arg(\d+)\}\}/g,
    (token, argIndex: string | undefined) => {
      if (token === '{{self}}') {
        return self;
      }
      const arg = args[Number(argIndex)];
      if (arg === undefined) {
        throw adapterError(
          'CONTRACT.PACK_CONTRIBUTION_INVALID',
          `Operation lowering template for "${expr.method}" referenced missing argument {{arg${argIndex}}}; template has ${args.length} arg(s)`,
          { meta: { method: expr.method } },
        );
      }
      return arg;
    },
  );
}

function renderJoin(join: JoinAst, contract: GaussDbContract, pim: ParamIndexMap): string {
  const joinType = join.joinType.toUpperCase();
  const lateral = join.lateral ? 'LATERAL ' : '';
  const source = renderSource(join.source, contract, pim);
  const onClause = renderJoinOn(join.on, contract, pim);
  return `${joinType} JOIN ${lateral}${source} ON ${onClause}`;
}

function renderJoinOn(on: JoinOnExpr, contract: GaussDbContract, pim: ParamIndexMap): string {
  if (on.kind === 'eq-col-join-on') {
    const left = renderColumn(on.left);
    const right = renderColumn(on.right);
    return `${left} = ${right}`;
  }
  return renderWhere(on, contract, pim);
}

function findInsertStorageTable(
  contract: GaussDbContract | undefined,
  tableRef: Pick<TableSource, 'name' | 'namespaceId'>,
): StorageTable | undefined {
  if (contract === undefined) {
    return undefined;
  }
  const tableName = tableRef.name;
  if (tableRef.namespaceId !== undefined) {
    const ns = contract.storage.namespaces[tableRef.namespaceId];
    const scoped = ns !== undefined ? ns.entries.table?.[tableName] : undefined;
    if (scoped !== undefined) {
      return scoped;
    }
  }
  for (const ns of Object.values(contract.storage.namespaces)) {
    const found = ns.entries.table?.[tableName];
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function collectKeyColumns(table: StorageTable | undefined): ReadonlySet<string> {
  const keyColumns = new Set<string>();
  if (table === undefined) {
    return keyColumns;
  }
  for (const column of table.primaryKey?.columns ?? []) {
    keyColumns.add(column);
  }
  for (const unique of table.uniques) {
    for (const column of unique.columns) {
      keyColumns.add(column);
    }
  }
  for (const index of table.indexes) {
    if (index.unique) {
      for (const column of index.columns ?? []) {
        keyColumns.add(column);
      }
    }
  }
  return keyColumns;
}

function getInsertColumnOrder(
  rows: ReadonlyArray<Record<string, InsertValue>>,
  contract: GaussDbContract,
  tableRef: Pick<TableSource, 'name' | 'namespaceId'>,
): string[] {
  const orderedColumns: string[] = [];
  const seenColumns = new Set<string>();

  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (seenColumns.has(column)) {
        continue;
      }
      seenColumns.add(column);
      orderedColumns.push(column);
    }
  }

  if (orderedColumns.length > 0) {
    return orderedColumns;
  }

  const table = findInsertStorageTable(contract, tableRef);
  if (table === undefined) {
    throw adapterError(
      'RUNTIME.AST_INVALID',
      `INSERT target table not found in contract storage: ${tableRef.name}`,
      { meta: { node: 'insert', table: tableRef.name } },
    );
  }
  return Object.keys(table.columns);
}

function renderInsertValue(
  value: InsertValue | undefined,
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  if (!value || value.kind === 'default-value') {
    return 'DEFAULT';
  }

  switch (value.kind) {
    case 'param-ref':
    case 'prepared-param-ref':
      return renderParamRef(value, pim);
    case 'column-ref':
      return renderColumn(value);
    case 'raw-expr':
      return renderExpr(value, contract, pim);
    // v8 ignore next 4
    default:
      assertNever(value, `Unsupported value node in INSERT: ${unreachableKind(value)}`);
  }
}

function renderInsert(ast: InsertAst, contract: GaussDbContract, pim: ParamIndexMap): string {
  const table = qualifyTableFromNamespaceCoordinate(ast.table, contract);
  const rows = ast.rows;
  if (rows.length === 0) {
    throw adapterError('RUNTIME.AST_INVALID', 'INSERT requires at least one row', {
      meta: { node: 'insert' },
    });
  }
  const hasExplicitValues = rows.some((row) => Object.keys(row).length > 0);
  const insertClause = (() => {
    if (!hasExplicitValues) {
      if (rows.length === 1) {
        return `INSERT INTO ${table} DEFAULT VALUES`;
      }

      const defaultColumns = getInsertColumnOrder(rows, contract, ast.table);
      if (defaultColumns.length === 0) {
        return `INSERT INTO ${table} VALUES ${rows.map(() => '()').join(', ')}`;
      }

      const quotedColumns = defaultColumns.map((column) => quoteIdentifier(column));
      const defaultRow = `(${defaultColumns.map(() => 'DEFAULT').join(', ')})`;
      return `INSERT INTO ${table} (${quotedColumns.join(', ')}) VALUES ${rows
        .map(() => defaultRow)
        .join(', ')}`;
    }

    const columnOrder = getInsertColumnOrder(rows, contract, ast.table);
    const columns = columnOrder.map((column) => quoteIdentifier(column));
    const values = rows
      .map((row) => {
        const renderedRow = columnOrder.map((column) =>
          renderInsertValue(row[column], contract, pim),
        );
        return `(${renderedRow.join(', ')})`;
      })
      .join(', ');

    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`;
  })();
  const onConflictClause = ast.onConflict
    ? (() => {
        const conflictColumnNames = ast.onConflict.columns.map((col) => col.column);
        if (conflictColumnNames.length === 0) {
          throw adapterError(
            'RUNTIME.AST_INVALID',
            'INSERT onConflict requires at least one conflict column',
            { meta: { node: 'insert-on-conflict' } },
          );
        }
        const conflictColumnSet = new Set(conflictColumnNames);

        const action = ast.onConflict.action;
        switch (action.kind) {
          case 'do-nothing': {
            // GaussDB rejects updates to any key column in ON DUPLICATE KEY
            // UPDATE — the primary key and every unique key, not only the
            // conflict target — so the no-op self-assignment must target a
            // non-key column; any table column may be referenced, including
            // ones outside the INSERT list. Without contract table metadata
            // (control-plane lowering passes no contract) the selection
            // degrades to insert columns minus conflict targets.
            const table = findInsertStorageTable(contract, ast.table);
            const keyColumns = collectKeyColumns(table);
            const candidateColumns =
              table !== undefined
                ? Object.keys(table.columns)
                : getInsertColumnOrder(rows, contract, ast.table);
            const noopColumn = candidateColumns.find(
              (column) => !conflictColumnSet.has(column) && !keyColumns.has(column),
            );
            if (noopColumn === undefined) {
              throw adapterError(
                'RUNTIME.AST_INVALID',
                table !== undefined
                  ? 'GaussDB cannot render DO NOTHING upsert: every column of this table is a key column. Use doUpdateSet instead.'
                  : 'GaussDB cannot render DO NOTHING upsert: every insert column is a conflict target. ' +
                      'Include at least one non-key column in the INSERT, or use doUpdateSet instead.',
                { meta: { node: 'insert-on-conflict' } },
              );
            }
            const noopIdentifier = quoteIdentifier(noopColumn);
            return ` ON DUPLICATE KEY UPDATE ${noopIdentifier} = ${noopIdentifier}`;
          }
          case 'do-update-set': {
            const updateEntries = Object.entries(action.set);
            if (updateEntries.length === 0) {
              throw adapterError(
                'RUNTIME.AST_INVALID',
                'INSERT onConflict do-update-set requires at least one assignment',
                { meta: { node: 'insert-on-conflict' } },
              );
            }
            const keyViolation = updateEntries.find(([colName]) => conflictColumnSet.has(colName));
            if (keyViolation !== undefined) {
              throw adapterError(
                'RUNTIME.AST_INVALID',
                `GaussDB rejects ON DUPLICATE KEY UPDATE assignments to conflict-target columns (got "${keyViolation[0]}"). ` +
                  'Remove the assignment to the conflict-target column or assign a different column.',
                { meta: { node: 'insert-on-conflict' } },
              );
            }
            const updates = updateEntries.map(([colName, value]) => {
              return `${quoteIdentifier(colName)} = ${renderExpr(value, contract, pim)}`;
            });
            return ` ON DUPLICATE KEY UPDATE ${updates.join(', ')}`;
          }
          // v8 ignore next 4
          default:
            assertNever(action, `Unsupported onConflict action: ${unreachableKind(action)}`);
        }
      })()
    : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${renderReturning(ast.returning, contract, pim)}`
    : '';

  return `${insertClause}${onConflictClause}${returningClause}`;
}

function renderUpdate(ast: UpdateAst, contract: GaussDbContract, pim: ParamIndexMap): string {
  const table = qualifyTableFromNamespaceCoordinate(ast.table, contract);
  const setEntries = Object.entries(ast.set);
  if (setEntries.length === 0) {
    throw adapterError('RUNTIME.AST_INVALID', 'UPDATE requires at least one SET assignment', {
      meta: { node: 'update' },
    });
  }
  const setClauses = setEntries.map(([col, val]) => {
    const column = quoteIdentifier(col);
    return `${column} = ${renderExpr(val, contract, pim)}`;
  });

  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where, contract, pim)}` : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${renderReturning(ast.returning, contract, pim)}`
    : '';

  return `UPDATE ${table} SET ${setClauses.join(', ')}${whereClause}${returningClause}`;
}

function renderDelete(ast: DeleteAst, contract: GaussDbContract, pim: ParamIndexMap): string {
  const table = qualifyTableFromNamespaceCoordinate(ast.table, contract);
  const whereClause = ast.where ? ` WHERE ${renderWhere(ast.where, contract, pim)}` : '';
  const returningClause = ast.returning?.length
    ? ` RETURNING ${renderReturning(ast.returning, contract, pim)}`
    : '';

  return `DELETE FROM ${table}${whereClause}${returningClause}`;
}

function renderParts(
  parts: RawExpr['parts'] | RawQueryAst['parts'],
  contract: GaussDbContract,
  pim: ParamIndexMap,
): string {
  return parts
    .map((part) => (typeof part === 'string' ? part : renderExpr(part, contract, pim)))
    .join('');
}

function renderRawExpr(node: RawExpr, contract: GaussDbContract, pim: ParamIndexMap): string {
  return renderParts(node.parts, contract, pim);
}

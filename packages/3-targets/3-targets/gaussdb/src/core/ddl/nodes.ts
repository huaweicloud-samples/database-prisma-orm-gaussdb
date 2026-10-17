import {
  type DdlColumn,
  DdlNode,
  type DdlTableConstraint,
} from '@internal/sql-relational-core/ast';
import type { RlsPolicyOperation } from '../rls/canonicalize';

// ---------------------------------------------------------------------------
// AlterTableAction — nested polymorphic hierarchy
// ---------------------------------------------------------------------------

export interface AlterTableActionVisitor<R> {
  addColumn(action: AddColumnAction): R;
  dropDefault(action: DropDefaultAction): R;
}

export abstract class AlterTableAction {
  abstract readonly kind: string;
  abstract accept<R>(visitor: AlterTableActionVisitor<R>): R;
}

export class AddColumnAction extends AlterTableAction {
  readonly kind = 'add-column' as const;
  readonly column: DdlColumn;

  constructor(column: DdlColumn) {
    super();
    this.column = column;
    Object.freeze(this);
  }

  override accept<R>(visitor: AlterTableActionVisitor<R>): R {
    return visitor.addColumn(this);
  }
}

export class DropDefaultAction extends AlterTableAction {
  readonly kind = 'drop-default' as const;
  readonly columnName: string;

  constructor(columnName: string) {
    super();
    this.columnName = columnName;
    Object.freeze(this);
  }

  override accept<R>(visitor: AlterTableActionVisitor<R>): R {
    return visitor.dropDefault(this);
  }
}

/**
 * The set of ALTER TABLE subactions currently expressible as typed DDL.
 *
 * The remaining actions — SetDefault, SetNotNull, DropNotNull,
 * AlterColumnType — are still emitted as raw SQL by `operations/columns.ts`
 * and join this union as they are converted to typed DDL. Until then it is
 * intentionally partial: only the ALTER subactions used by the
 * already-converted ops (AddColumn, DropDefault) appear here.
 */
export type AnyAlterTableAction = AddColumnAction | DropDefaultAction;

// ---------------------------------------------------------------------------
// Top-level DDL visitor
// ---------------------------------------------------------------------------

export interface GaussDbDdlVisitor<R> {
  createTable(node: GaussDbCreateTable): R;
  createSchema(node: GaussDbCreateSchema): R;
  createType(node: GaussDbCreateType): R;
  dropType(node: GaussDbDropType): R;
  alterTable(node: GaussDbAlterTable): R;
  createPolicy(node: GaussDbCreatePolicy): R;
  dropPolicy(node: GaussDbDropPolicy): R;
  alterPolicyRename(node: GaussDbAlterPolicyRename): R;
  createIndex(node: GaussDbCreateIndex): R;
  dropIndex(node: GaussDbDropIndex): R;
  alterIndexRename(node: GaussDbAlterIndexRename): R;
  disableRowLevelSecurity(node: GaussDbDisableRowLevelSecurity): R;
}

export abstract class GaussDbDdlNode extends DdlNode {
  abstract accept<R>(visitor: GaussDbDdlVisitor<R>): R;
}

function freezeDdlColumns(columns: readonly DdlColumn[]): ReadonlyArray<DdlColumn> {
  return Object.freeze([...columns]);
}

function freezeConstraints(
  constraints: readonly DdlTableConstraint[] | undefined,
): ReadonlyArray<DdlTableConstraint> | undefined {
  return constraints ? Object.freeze([...constraints]) : undefined;
}

export class GaussDbCreateTable extends GaussDbDdlNode {
  readonly kind = 'create-table' as const;
  readonly table: string;
  readonly schema: string | undefined;
  readonly ifNotExists: boolean | undefined;
  readonly columns: ReadonlyArray<DdlColumn>;
  readonly constraints: ReadonlyArray<DdlTableConstraint> | undefined;

  constructor(options: {
    readonly table: string;
    readonly schema?: string;
    readonly ifNotExists?: boolean;
    readonly columns: readonly DdlColumn[];
    readonly constraints?: readonly DdlTableConstraint[];
  }) {
    super();
    this.table = options.table;
    this.schema = options.schema;
    this.ifNotExists = options.ifNotExists;
    this.columns = freezeDdlColumns(options.columns);
    this.constraints = freezeConstraints(options.constraints);
    this.freeze();
  }

  override accept<R>(visitor: GaussDbDdlVisitor<R>): R {
    return visitor.createTable(this);
  }
}

export class GaussDbCreateSchema extends GaussDbDdlNode {
  readonly kind = 'create-schema' as const;
  readonly schema: string;
  readonly ifNotExists: boolean | undefined;

  constructor(options: { readonly schema: string; readonly ifNotExists?: boolean }) {
    super();
    this.schema = options.schema;
    this.ifNotExists = options.ifNotExists;
    this.freeze();
  }

  override accept<R>(visitor: GaussDbDdlVisitor<R>): R {
    return visitor.createSchema(this);
  }
}

export class GaussDbCreateType extends GaussDbDdlNode {
  readonly kind = 'create-type' as const;
  readonly schema: string | undefined;
  readonly name: string;
  readonly values: ReadonlyArray<string>;

  constructor(options: {
    readonly schema?: string;
    readonly name: string;
    readonly values: readonly string[];
  }) {
    super();
    this.schema = options.schema;
    this.name = options.name;
    this.values = Object.freeze([...options.values]);
    this.freeze();
  }

  override accept<R>(visitor: GaussDbDdlVisitor<R>): R {
    return visitor.createType(this);
  }
}

export class GaussDbDropType extends GaussDbDdlNode {
  readonly kind = 'drop-type' as const;
  readonly schema: string | undefined;
  readonly name: string;

  constructor(options: { readonly schema?: string; readonly name: string }) {
    super();
    this.schema = options.schema;
    this.name = options.name;
    this.freeze();
  }

  override accept<R>(visitor: GaussDbDdlVisitor<R>): R {
    return visitor.dropType(this);
  }
}

export class GaussDbAlterTable extends GaussDbDdlNode {
  readonly kind = 'alter-table' as const;
  readonly table: string;
  readonly schema: string | undefined;
  readonly actions: ReadonlyArray<AnyAlterTableAction>;

  constructor(options: {
    readonly table: string;
    readonly schema?: string;
    readonly actions: readonly AnyAlterTableAction[];
  }) {
    super();
    this.table = options.table;
    this.schema = options.schema;
    this.actions = Object.freeze([...options.actions]);
    this.freeze();
  }

  override accept<R>(visitor: GaussDbDdlVisitor<R>): R {
    return visitor.alterTable(this);
  }
}

export type { RlsPolicyOperation };

export class GaussDbCreatePolicy extends GaussDbDdlNode {
  readonly kind = 'create-policy' as const;
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly permissive: boolean;
  readonly operation: RlsPolicyOperation;
  readonly roles: ReadonlyArray<string>;
  readonly using: string | undefined;
  readonly withCheck: string | undefined;

  constructor(options: {
    readonly schema: string;
    readonly table: string;
    readonly name: string;
    readonly permissive: boolean;
    readonly operation: RlsPolicyOperation;
    readonly roles: readonly string[];
    readonly using?: string;
    readonly withCheck?: string;
  }) {
    super();
    this.schema = options.schema;
    this.table = options.table;
    this.name = options.name;
    this.permissive = options.permissive;
    this.operation = options.operation;
    this.roles = Object.freeze([...options.roles]);
    this.using = options.using;
    this.withCheck = options.withCheck;
    this.freeze();
  }

  override accept<R>(visitor: GaussDbDdlVisitor<R>): R {
    return visitor.createPolicy(this);
  }
}

export class GaussDbDropPolicy extends GaussDbDdlNode {
  readonly kind = 'drop-policy' as const;
  readonly schema: string;
  readonly table: string;
  readonly name: string;

  constructor(options: { readonly schema: string; readonly table: string; readonly name: string }) {
    super();
    this.schema = options.schema;
    this.table = options.table;
    this.name = options.name;
    this.freeze();
  }

  override accept<R>(visitor: GaussDbDdlVisitor<R>): R {
    return visitor.dropPolicy(this);
  }
}

export class GaussDbAlterPolicyRename extends GaussDbDdlNode {
  readonly kind = 'alter-policy-rename' as const;
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly newName: string;

  constructor(options: {
    readonly schema: string;
    readonly table: string;
    readonly name: string;
    readonly newName: string;
  }) {
    super();
    this.schema = options.schema;
    this.table = options.table;
    this.name = options.name;
    this.newName = options.newName;
    this.freeze();
  }

  override accept<R>(visitor: GaussDbDdlVisitor<R>): R {
    return visitor.alterPolicyRename(this);
  }
}

/**
 * The element list between the parens of CREATE INDEX: either a column
 * tuple (each identifier quoted by the renderer) or one opaque expression
 * string covering the entire list, inserted verbatim — the same opaque-SQL
 * stance as RLS policy predicates (ADR 234).
 */
export type DdlIndexElements =
  | { readonly columns: readonly string[] }
  | { readonly expression: string };

export class GaussDbCreateIndex extends GaussDbDdlNode {
  readonly kind = 'create-index' as const;
  /** Absent ⇔ unqualified (the unbound namespace — `search_path` decides). */
  readonly schema: string | undefined;
  readonly table: string;
  readonly name: string;
  readonly unique: boolean;
  readonly elements: DdlIndexElements;
  readonly type: string | undefined;
  readonly options: Record<string, unknown> | undefined;
  /**
   * Partial-index predicate (WHERE body, without the keyword). Inserted
   * verbatim, never quoted or escaped.
   */
  readonly where: string | undefined;

  constructor(options: {
    readonly schema: string | undefined;
    readonly table: string;
    readonly name: string;
    readonly unique: boolean;
    readonly elements: DdlIndexElements;
    readonly type: string | undefined;
    readonly options: Record<string, unknown> | undefined;
    readonly where: string | undefined;
  }) {
    super();
    this.schema = options.schema;
    this.table = options.table;
    this.name = options.name;
    this.unique = options.unique;
    this.elements =
      'columns' in options.elements
        ? { columns: Object.freeze([...options.elements.columns]) }
        : { expression: options.elements.expression };
    this.type = options.type;
    this.options = options.options;
    this.where = options.where;
    this.freeze();
  }

  override accept<R>(visitor: GaussDbDdlVisitor<R>): R {
    return visitor.createIndex(this);
  }
}

export class GaussDbDropIndex extends GaussDbDdlNode {
  readonly kind = 'drop-index' as const;
  /** Absent ⇔ unqualified (the unbound namespace). */
  readonly schema: string | undefined;
  readonly name: string;

  constructor(options: { readonly schema: string | undefined; readonly name: string }) {
    super();
    this.schema = options.schema;
    this.name = options.name;
    this.freeze();
  }

  override accept<R>(visitor: GaussDbDdlVisitor<R>): R {
    return visitor.dropIndex(this);
  }
}

export class GaussDbAlterIndexRename extends GaussDbDdlNode {
  readonly kind = 'alter-index-rename' as const;
  /** Absent ⇔ unqualified (the unbound namespace). */
  readonly schema: string | undefined;
  readonly from: string;
  readonly to: string;

  constructor(options: {
    readonly schema: string | undefined;
    readonly from: string;
    readonly to: string;
  }) {
    super();
    this.schema = options.schema;
    this.from = options.from;
    this.to = options.to;
    this.freeze();
  }

  override accept<R>(visitor: GaussDbDdlVisitor<R>): R {
    return visitor.alterIndexRename(this);
  }
}

export class GaussDbDisableRowLevelSecurity extends GaussDbDdlNode {
  readonly kind = 'disable-row-level-security' as const;
  readonly schema: string;
  readonly table: string;

  constructor(options: { readonly schema: string; readonly table: string }) {
    super();
    this.schema = options.schema;
    this.table = options.table;
    this.freeze();
  }

  override accept<R>(visitor: GaussDbDdlVisitor<R>): R {
    return visitor.disableRowLevelSecurity(this);
  }
}

export type AnyGaussDbDdlNode =
  | GaussDbCreateTable
  | GaussDbCreateSchema
  | GaussDbCreateType
  | GaussDbDropType
  | GaussDbAlterTable
  | GaussDbCreatePolicy
  | GaussDbDropPolicy
  | GaussDbAlterPolicyRename
  | GaussDbCreateIndex
  | GaussDbDropIndex
  | GaussDbAlterIndexRename
  | GaussDbDisableRowLevelSecurity;

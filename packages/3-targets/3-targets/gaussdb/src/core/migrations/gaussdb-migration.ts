import type { Contract } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { Migration as SqlMigration } from '@internal/family-sql/migration';
import type { ControlStack } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { MigrationContractViews } from '@internal/migration-tools/migration';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { DdlColumn, DdlTableConstraint } from '@internal/sql-relational-core/ast';
import { errorGaussDbMigrationStackMissing } from '../errors';
import { GaussDbContractView } from '../gaussdb-contract-view';
import { GaussDbRlsPolicy, type RenderedRlsPolicyLiteral } from '../gaussdb-rls-policy';
import {
  AddCheckConstraintCall,
  AddColumnCall,
  AddForeignKeyCall,
  AddNativeEnumValueCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  type AlterColumnTypeOptions,
  CreateGaussDbRlsPolicyCall,
  CreateIndexCall,
  CreateNativeEnumTypeCall,
  CreateSchemaCall,
  CreateTableCall,
  DisableRowLevelSecurityCall,
  DropCheckConstraintCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropGaussDbRlsPolicyCall,
  DropIndexCall,
  DropNativeEnumTypeCall,
  DropNotNullCall,
  DropTableCall,
  EnableRowLevelSecurityCall,
  RenameCheckConstraintCall,
  RenameGaussDbRlsPolicyCall,
  RenameIndexCall,
  SetDefaultCall,
  SetNotNullCall,
} from './op-factory-call';
import { type DataTransformOptions, dataTransform } from './operations/data-transform';
import { installExtension } from './operations/dependencies';
import type { CreateIndexExtras } from './operations/indexes';
import type { ForeignKeySpec } from './operations/shared';
import type { GaussDbPlanTargetDetails } from './planner-target-details';

/**
 * Target-owned base class for GaussDB migrations.
 *
 * Fixes the `SqlMigration` generic to `GaussDbPlanTargetDetails` and the
 * abstract `targetId` to the GaussDB target-id string literal, so both
 * user-authored migrations and renderer-generated scaffolds (the output of
 * `renderCallsToTypeScript`) can extend `GaussDbMigration` directly without
 * redeclaring target-local identity.
 *
 * Mirrors `MongoMigration` in `@internal/family-mongo`: the renderer
 * emits `extends Migration` against a facade re-export of this class
 * from `@internal/postgres/migration`, keeping the authoring surface
 * target-scoped rather than family-scoped.
 *
 * The constructor materializes a single GaussDB `SqlControlAdapter` from
 * `stack.adapter.create(stack)` and stores it; the protected `dataTransform`
 * instance method forwards to the free `dataTransform` factory with that
 * stored adapter, so user migrations can write `this.dataTransform(...)`
 * without threading the adapter through every call.
 *
 * Every method requires an explicit `schema`. GaussDB migrations name their
 * schema deliberately — there is no default and no `search_path`-relative
 * option. A migration that left the schema unspecified would resolve against
 * whatever `search_path` the connection happened to carry, and that ambiguity
 * is an antipattern in a migration. (The unbound/unspecified namespace concept
 * remains for SQLite, which has no schemas, and for Mongo's connection `db`.)
 */
export abstract class GaussDbMigration<
  Start extends Contract<SqlStorage> = Contract<SqlStorage>,
  End extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlMigration<GaussDbPlanTargetDetails, 'gaussdb', Start, End> {
  readonly targetId = 'gaussdb' as const;

  /**
   * Materialized GaussDB control adapter, created once per migration
   * instance from the injected stack. `undefined` only when the migration
   * was instantiated without a stack (test fixtures); `controlAdapterFor`
   * throws a MIGRATION.GAUSSDB_CONTROL_STACK_MISSING in that case to surface the misuse.
   */
  protected readonly controlAdapter: SqlControlAdapter<'gaussdb'> | undefined;

  #endView = new MigrationContractViews<GaussDbContractView<End>>(
    this,
    'GaussDbMigration',
    (json) => GaussDbContractView.fromJson<End>(json),
  );
  #startView = new MigrationContractViews<GaussDbContractView<Start>>(
    this,
    'GaussDbMigration',
    (json) => GaussDbContractView.fromJson<Start>(json),
  );

  constructor(stack?: ControlStack<'sql', 'gaussdb'>) {
    super(stack);
    // The descriptor `create()` is typed as the wider `ControlAdapterInstance`;
    // the GaussDB descriptor concretely returns a `SqlControlAdapter<'gaussdb'>`,
    // so the cast holds for any GaussDB-target stack assembled at runtime.
    this.controlAdapter = stack?.adapter
      ? (stack.adapter.create(stack) as SqlControlAdapter<'gaussdb'>)
      : undefined;
  }

  /**
   * Returns the materialized control adapter, or throws a MIGRATION.GAUSSDB_CONTROL_STACK_MISSING naming
   * `operation` when the migration was constructed without a `ControlStack`.
   * Single home for the null-check that every DDL/DML method shares.
   */
  private controlAdapterFor(operation: string): SqlControlAdapter<'gaussdb'> {
    if (!this.controlAdapter) {
      throw errorGaussDbMigrationStackMissing(operation);
    }
    return this.controlAdapter;
  }

  /**
   * The typed, schema-qualified GaussDB view over this migration's end-state
   * contract — `this.endContract.namespace.<schema>.table.<name>`, etc. Throws
   * if no `endContractJson` was provided.
   */
  get endContract(): GaussDbContractView<End> {
    return this.#endView.endContract;
  }

  /**
   * The typed GaussDB view over this migration's start-state contract, or
   * `null` for a baseline migration (no `startContractJson`).
   */
  get startContract(): GaussDbContractView<Start> | null {
    return this.#startView.startContract;
  }

  /**
   * Instance-method wrapper around the free `dataTransform` factory that
   * supplies the stored control adapter. Authors call this from inside
   * `get operations()`; the adapter argument is hidden from the call site.
   */
  protected dataTransform<TContract extends Contract<SqlStorage>>(
    contract: TContract,
    name: string,
    options: DataTransformOptions,
  ): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return dataTransform(contract, name, options, this.controlAdapterFor('dataTransform'));
  }

  /**
   * Emit a `CREATE TABLE` migration operation. Builds a typed DDL node from
   * the supplied options and lowers it through the stored control adapter.
   * Throws if no adapter is present (i.e. migration instantiated without a stack).
   */
  protected createTable(options: {
    readonly schema: string;
    readonly table: string;
    readonly ifNotExists?: boolean;
    readonly columns: readonly DdlColumn[];
    readonly constraints?: readonly DdlTableConstraint[];
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new CreateTableCall(
      options.schema,
      options.table,
      options.columns,
      options.constraints,
    ).toOp(this.controlAdapterFor('createTable'));
  }

  /**
   * Emit a `CREATE SCHEMA` migration operation. Builds a typed DDL node from
   * the supplied options and lowers it through the stored control adapter.
   * Throws if no adapter is present (i.e. migration instantiated without a stack).
   */
  protected createSchema(options: {
    readonly schema: string;
    readonly ifNotExists?: boolean;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new CreateSchemaCall(options.schema).toOp(this.controlAdapterFor('createSchema'));
  }

  /**
   * Emit a `CREATE TYPE ... AS ENUM (...)` migration operation for a managed
   * native enum. Builds a typed DDL node and lowers it through the stored
   * control adapter (members render in declaration order). Throws if no adapter
   * is present.
   */
  protected createNativeEnumType(options: {
    readonly schema: string;
    readonly typeName: string;
    readonly members: readonly string[];
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new CreateNativeEnumTypeCall(options.schema, options.typeName, options.members).toOp(
      this.controlAdapterFor('createNativeEnumType'),
    );
  }

  /**
   * Emit a `DROP TYPE` migration operation for a managed native enum, lowered
   * through the stored control adapter. Throws if no adapter is present.
   */
  protected dropNativeEnumType(options: {
    readonly schema: string;
    readonly typeName: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new DropNativeEnumTypeCall(options.schema, options.typeName).toOp(
      this.controlAdapterFor('dropNativeEnumType'),
    );
  }

  /**
   * Emit an `ALTER TYPE ... ADD VALUE` migration operation appending one
   * member to a managed native enum, lowered through the stored control
   * adapter. Throws if no adapter is present. Every appended value is its
   * own operation — call this once per value to append more than one.
   */
  protected addNativeEnumValue(options: {
    readonly schema: string;
    readonly typeName: string;
    readonly value: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new AddNativeEnumValueCall(options.schema, options.typeName, options.value).toOp(
      this.controlAdapterFor('addNativeEnumValue'),
    );
  }

  protected addColumn(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: DdlColumn;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new AddColumnCall(options.schema, options.table, options.column).toOp(
      this.controlAdapterFor('addColumn'),
    );
  }

  protected addPrimaryKey(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly columns: readonly string[];
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new AddPrimaryKeyCall(
      options.schema,
      options.table,
      options.constraint,
      options.columns,
    ).toOp(this.controlAdapterFor('addPrimaryKey'));
  }

  protected addUnique(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly columns: readonly string[];
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new AddUniqueCall(
      options.schema,
      options.table,
      options.constraint,
      options.columns,
    ).toOp(this.controlAdapterFor('addUnique'));
  }

  protected addForeignKey(options: {
    readonly schema: string;
    readonly table: string;
    readonly foreignKey: ForeignKeySpec;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new AddForeignKeyCall(options.schema, options.table, options.foreignKey).toOp(
      this.controlAdapterFor('addForeignKey'),
    );
  }

  protected addCheckConstraint(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly expression: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new AddCheckConstraintCall(
      options.schema,
      options.table,
      options.constraint,
      options.expression,
    ).toOp(this.controlAdapterFor('addCheckConstraint'));
  }

  protected renameCheckConstraint(options: {
    readonly schema?: string;
    readonly table: string;
    readonly from: string;
    readonly to: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new RenameCheckConstraintCall(
      options.schema ?? UNBOUND_NAMESPACE_ID,
      options.table,
      options.from,
      options.to,
    ).toOp(this.controlAdapterFor('renameCheckConstraint'));
  }

  protected dropCheckConstraint(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new DropCheckConstraintCall(options.schema, options.table, options.constraint).toOp(
      this.controlAdapterFor('dropCheckConstraint'),
    );
  }

  protected dropConstraint(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly kind?: 'foreignKey' | 'unique' | 'primaryKey';
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new DropConstraintCall(
      options.schema,
      options.table,
      options.constraint,
      options.kind ?? 'unique',
    ).toOp(this.controlAdapterFor('dropConstraint'));
  }

  protected dropTable(options: {
    readonly schema: string;
    readonly table: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new DropTableCall(options.schema, options.table).toOp(
      this.controlAdapterFor('dropTable'),
    );
  }

  protected dropColumn(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new DropColumnCall(options.schema, options.table, options.column).toOp(
      this.controlAdapterFor('dropColumn'),
    );
  }

  protected alterColumnType(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
    readonly options: AlterColumnTypeOptions;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new AlterColumnTypeCall(
      options.schema,
      options.table,
      options.column,
      options.options,
    ).toOp(this.controlAdapterFor('alterColumnType'));
  }

  protected setNotNull(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new SetNotNullCall(options.schema, options.table, options.column).toOp(
      this.controlAdapterFor('setNotNull'),
    );
  }

  protected dropNotNull(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new DropNotNullCall(options.schema, options.table, options.column).toOp(
      this.controlAdapterFor('dropNotNull'),
    );
  }

  protected setDefault(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
    readonly defaultSql: string;
    readonly operationClass?: 'additive' | 'widening';
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new SetDefaultCall(
      options.schema,
      options.table,
      options.column,
      options.defaultSql,
      options.operationClass,
    ).toOp(this.controlAdapterFor('setDefault'));
  }

  protected dropDefault(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new DropDefaultCall(options.schema, options.table, options.column).toOp(
      this.controlAdapterFor('dropDefault'),
    );
  }

  protected createIndex(
    options: {
      readonly schema: string;
      readonly table: string;
      readonly index: string;
      readonly extras?: CreateIndexExtras;
    } & (
      | { readonly columns: readonly string[]; readonly expression?: never }
      | { readonly expression: string; readonly columns?: never }
    ),
  ): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new CreateIndexCall(
      options.schema,
      options.table,
      options.index,
      options.columns !== undefined
        ? { columns: options.columns }
        : { expression: options.expression },
      options.extras,
    ).toOp(this.controlAdapterFor('createIndex'));
  }

  protected renameIndex(options: {
    readonly schema: string;
    readonly table: string;
    readonly from: string;
    readonly to: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new RenameIndexCall(options.schema, options.table, options.from, options.to).toOp(
      this.controlAdapterFor('renameIndex'),
    );
  }

  protected dropIndex(options: {
    readonly schema: string;
    readonly table: string;
    readonly index: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new DropIndexCall(options.schema, options.table, options.index).toOp(
      this.controlAdapterFor('dropIndex'),
    );
  }

  protected installExtension(options: {
    readonly extensionName: string;
    readonly invariantId: string;
    readonly id: string;
    readonly label?: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return installExtension(options, this.controlAdapterFor('installExtension'));
  }

  protected enableRowLevelSecurity(options: {
    readonly schema: string;
    readonly table: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new EnableRowLevelSecurityCall(options.schema, options.table).toOp(
      this.controlAdapterFor('enableRowLevelSecurity'),
    );
  }

  protected disableRowLevelSecurity(options: {
    readonly schema: string;
    readonly table: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new DisableRowLevelSecurityCall(options.schema, options.table).toOp(
      this.controlAdapterFor('disableRowLevelSecurity'),
    );
  }

  protected createRlsPolicy(options: {
    readonly schema: string;
    readonly table: string;
    readonly policy: RenderedRlsPolicyLiteral;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new CreateGaussDbRlsPolicyCall(
      options.schema,
      options.table,
      new GaussDbRlsPolicy({
        ...options.policy,
        using: options.policy.using,
        withCheck: options.policy.withCheck,
      }),
    ).toOp(this.controlAdapterFor('createRlsPolicy'));
  }

  protected dropRlsPolicy(options: {
    readonly schema: string;
    readonly table: string;
    readonly policy: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new DropGaussDbRlsPolicyCall(options.schema, options.table, options.policy).toOp(
      this.controlAdapterFor('dropRlsPolicy'),
    );
  }

  protected renameRlsPolicy(options: {
    readonly schema: string;
    readonly table: string;
    readonly from: string;
    readonly to: string;
  }): Promise<SqlMigrationPlanOperation<GaussDbPlanTargetDetails>> {
    return new RenameGaussDbRlsPolicyCall(
      options.schema,
      options.table,
      options.from,
      options.to,
    ).toOp(this.controlAdapterFor('renameRlsPolicy'));
  }
}

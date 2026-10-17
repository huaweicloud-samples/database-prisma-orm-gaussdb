import type { Contract } from '@internal/contract/types';
import {
  freezeNode,
  hydrateNamespaceEntities,
  UNBOUND_NAMESPACE_ID,
} from '@internal/framework-components/ir';
import { composeSqlEntityKinds } from '@internal/sql-contract/entity-kinds';
import {
  SqlNamespaceBase,
  type SqlNamespaceEntries,
  type SqlNamespaceInput,
  type SqlStorage,
  type StorageTable,
  type StorageValueSet,
} from '@internal/sql-contract/types';

import { type CfExpr, cfExpr } from '@internal/sql-relational-core/contract-free';
import { invariant } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { GaussDbTableSource } from './ast/table-source';
import { PG_TEXT_CODEC_ID } from './codec-ids';
import {
  nativeEnumEntityKind,
  policyEntityKind,
  rlsEnablementEntityKind,
  roleEntityKind,
} from './entity-kinds';
import { GaussDbNativeEnum } from './gaussdb-native-enum';
import type { GaussDbRlsEnablement } from './gaussdb-rls-enablement';
import type { GaussDbRlsPolicy } from './gaussdb-rls-policy';
import type { GaussDbRole } from './gaussdb-role';
import { escapeLiteral } from './sql-utils';

export type GaussDbContract = Contract<SqlStorage> & { readonly target: 'gaussdb' };

export type GaussDbNamespaceEntries = SqlNamespaceEntries & {
  readonly policy?: Readonly<Record<string, GaussDbRlsPolicy>>;
  readonly role?: Readonly<Record<string, GaussDbRole>>;
  readonly rls?: Readonly<Record<string, GaussDbRlsEnablement>>;
  readonly native_enum?: Readonly<Record<string, GaussDbNativeEnum>>;
};

export interface GaussDbSchemaInput {
  readonly id: string;
  readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * GaussDB target `Namespace` concretion — a GaussDB schema (`CREATE
 * SCHEMA …`). Each GaussDB `SqlStorage` carries a
 * `namespaces: Record<NamespaceId, GaussDbSchema>` map populated by
 * the GaussDB PSL interpreter from `namespace { … }` AST buckets.
 *
 * `entries` holds entity-kind maps (`table`, `valueSet`). Qualifier
 * emission is the rendering seam: DDL / SQL emission asks the namespace
 * for its qualifier (`"<schema>"`) or for a qualified table name
 * (`"<schema>"."<table>"`) and consumes the result polymorphically.
 * The unbound singleton below overrides these methods to elide the
 * prefix entirely — call sites stay polymorphic and never branch on
 * `id === UNBOUND_NAMESPACE_ID`.
 */
export class GaussDbSchema extends SqlNamespaceBase {
  /**
   * Stable singleton reference for the late-bound slot. Materialised
   * lazily below the singleton subclass declaration so the static
   * initialiser sees the subclass before assigning. Consumers always
   * reach for `GaussDbSchema.unbound` (or `GaussDbUnboundSchema.instance`
   * — same identity).
   */
  static unbound: GaussDbUnboundSchema;

  declare readonly kind: 'schema';
  readonly id: string;
  readonly entries: GaussDbNamespaceEntries;

  constructor(input: GaussDbSchemaInput) {
    super();
    this.id = input.id;

    const dispatched = hydrateNamespaceEntities(
      input.entries,
      composeSqlEntityKinds([
        policyEntityKind,
        roleEntityKind,
        rlsEnablementEntityKind,
        nativeEnumEntityKind,
      ]),
      'carry',
    );

    // A native enum keys under its PHYSICAL type name in storage `entries`
    // (ADR 221 coordinate `entityName`). The family/authoring layer keys every
    // block by its author handle, so re-key the `native_enum` slot by each
    // entity's `typeName` here — target-local GaussDB code that already knows
    // this entity kind. This runs at both authoring and hydration; a serialized
    // contract's key already equals the `typeName`, so the re-key is idempotent.
    const nativeEnumSlot = dispatched['native_enum'];
    if (nativeEnumSlot !== undefined) {
      const rekeyed: Record<string, unknown> = {};
      for (const [handle, entity] of Object.entries(nativeEnumSlot)) {
        const physicalName = GaussDbNativeEnum.is(entity) ? entity.typeName : handle;
        invariant(
          !Object.hasOwn(rekeyed, physicalName),
          `GaussDbSchema "${input.id}": two native_enum entities resolve to the same physical type name "${physicalName}". Give them distinct @@map type names.`,
        );
        rekeyed[physicalName] = entity;
      }
      dispatched['native_enum'] = Object.freeze(rekeyed);
    }

    // Drop an empty valueSet so presence signals non-emptiness.
    const valueSetRaw = dispatched['valueSet'];
    const withPresence =
      valueSetRaw !== undefined && Object.keys(valueSetRaw).length === 0
        ? { ...dispatched, valueSet: undefined }
        : dispatched;

    const entriesInput: Record<string, Readonly<Record<string, unknown>> | undefined> = {
      ...withPresence,
    };

    this.entries = Object.freeze(
      blindCast<
        GaussDbNamespaceEntries,
        'composeSqlEntityKinds([policyEntityKind, roleEntityKind, rlsEnablementEntityKind, nativeEnumEntityKind]) supplies table→StorageTable, valueSet→StorageValueSet, policy→GaussDbRlsPolicy, role→GaussDbRole, rls→GaussDbRlsEnablement, native_enum→GaussDbNativeEnum descriptors'
      >(entriesInput),
    );
    Object.defineProperty(this, 'kind', {
      value: 'schema',
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }

  get table(): Readonly<Record<string, StorageTable>> {
    return this.entries.table ?? Object.freeze({});
  }

  get valueSet(): Readonly<Record<string, StorageValueSet>> | undefined {
    return this.entries.valueSet;
  }

  get policy(): Readonly<Record<string, GaussDbRlsPolicy>> {
    return this.entries.policy ?? Object.freeze({});
  }

  get role(): Readonly<Record<string, GaussDbRole>> {
    return this.entries.role ?? Object.freeze({});
  }

  get rls(): Readonly<Record<string, GaussDbRlsEnablement>> {
    return this.entries.rls ?? Object.freeze({});
  }

  /**
   * The bare schema qualifier as it would appear in a rendered SQL
   * fragment (already quoted). The unbound-schema singleton overrides
   * this to return `''`.
   */
  qualifier(): string {
    return `"${this.id}"`;
  }

  /**
   * Qualify a table name with the schema prefix
   * (`"<schema>"."<table>"`). The unbound-schema singleton overrides
   * this to emit just `"<table>"` so the resolved DDL is unqualified
   * and `search_path` decides where the object lands at runtime.
   */
  qualifyTable(tableName: string): string {
    return `"${this.id}"."${tableName}"`;
  }

  /**
   * Render a SQL string-literal containing the qualified-name form
   * suitable for `to_regclass(...)` arguments (e.g. `'"public"."user"'`).
   * The unbound singleton overrides this to elide the schema prefix
   * (`'"user"'`) so `search_path` resolves the object at runtime.
   */
  regclassLiteral(name: string): string {
    return `'${escapeLiteral(this.qualifyTable(name))}'`;
  }

  /**
   * Render a SQL expression that evaluates to this namespace's schema
   * name at runtime, ready to drop into a `WHERE table_schema = …` /
   * `WHERE n.nspname = …` clause. Named schemas emit a quoted SQL
   * literal (`'public'`); the unbound singleton overrides this to emit
   * `current_schema()` so catalog queries match whichever schema the
   * connection's `search_path` resolved at runtime.
   */
  schemaSqlExpression(): string {
    return `'${escapeLiteral(this.id)}'`;
  }

  /**
   * Typed-AST counterpart of {@link schemaSqlExpression}: the expression a
   * builder-built catalog check compares `n.nspname` / `table_schema`
   * against. Named schemas bind the schema name as a text parameter; the
   * unbound singleton overrides this to the opaque `current_schema()`
   * expression so the live connection's `search_path` decides at runtime.
   */
  schemaFilterExpression(): CfExpr {
    return cfExpr.param(this.id, PG_TEXT_CODEC_ID);
  }

  /**
   * Typed-AST counterpart of {@link qualifyTable}: the FROM source a
   * builder-built check uses to address a user table in this namespace.
   * Named schemas qualify (`"schema"."table"`); the unbound singleton
   * overrides this to leave the table unqualified so `search_path`
   * resolves it at runtime.
   */
  tableSource(tableName: string, alias?: string): GaussDbTableSource {
    return new GaussDbTableSource({
      name: tableName,
      schema: this.id,
      ...ifDefined('alias', alias),
    });
  }

  /**
   * The bare schema name a DDL planner should target when emitting
   * statements that need to identify this namespace in the live
   * database (e.g. `CREATE TABLE "<ddlSchemaName>"."<table>" …`,
   * catalog filters, planner conflict lookups). Named schemas resolve
   * to their own id. The `GaussDbUnboundSchema` singleton inherits
   * this and returns `UNBOUND_NAMESPACE_ID` — callers that dispatch
   * through `qualifyTableName` route through the polymorphic
   * `GaussDbUnboundSchema` overrides and produce unqualified
   * (search-path-resolved) output automatically.
   */
  ddlSchemaName(_storage: SqlStorage): string {
    return this.id;
  }
}

/**
 * Singleton subclass for the reserved sentinel namespace id
 * (`UNBOUND_NAMESPACE_ID`) — the late-bound GaussDB slot whose binding
 * the connection's `search_path` resolves at runtime. Overrides
 * qualifier emission to elide the schema prefix; call sites that consume
 * `qualifier()` / `qualifyTable()` get unqualified output without
 * branching on the namespace id.
 *
 * This is the target-side materialization of "the framework provides
 * affordances; targets implement specifics": the framework names the
 * sentinel; GaussDB decides what late-bound means here (the table
 * name, naked — the schema is supplied by the live connection's
 * `search_path`).
 *
 * `ddlSchemaName` is inherited from `GaussDbSchema` and returns
 * `UNBOUND_NAMESPACE_ID`. Downstream helpers such as `qualifyTableName`
 * route through the polymorphic factory and produce unqualified output
 * automatically.
 */
export class GaussDbUnboundSchema extends GaussDbSchema {
  static readonly instance: GaussDbUnboundSchema = new GaussDbUnboundSchema();

  constructor(input?: GaussDbSchemaInput) {
    super(input ?? { id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
  }

  override qualifier(): string {
    return '';
  }

  override qualifyTable(tableName: string): string {
    return `"${tableName}"`;
  }

  override schemaSqlExpression(): string {
    return 'current_schema()';
  }

  override schemaFilterExpression(): CfExpr {
    return cfExpr.raw('current_schema()', { codecId: PG_TEXT_CODEC_ID, nullable: false });
  }

  override tableSource(tableName: string, alias?: string): GaussDbTableSource {
    return new GaussDbTableSource({
      name: tableName,
      ...ifDefined('alias', alias),
    });
  }
}

GaussDbSchema.unbound = GaussDbUnboundSchema.instance;

/**
 * Narrow an arbitrary namespace (or `undefined`) to `GaussDbSchema`
 * so callers can dispatch to the polymorphic emission methods without
 * branching at the call site. Uses the structural `kind` discriminator
 * (`'schema'`) rather than `instanceof` so the check survives realm /
 * bundle / hot-reload boundaries — matching the rest of the IR's
 * narrowing convention. `GaussDbUnboundSchema` passes through because
 * it inherits the same `kind: 'schema'` from `GaussDbSchema`.
 */
export function isGaussDbSchema(ns: unknown): ns is GaussDbSchema {
  return (ns as { kind?: unknown } | null | undefined)?.kind === 'schema';
}

/**
 * Target-supplied `Namespace` factory the GaussDB target plumbs
 * through `defineContract({ createNamespace })` and the SQL PSL
 * interpreter. Returns the unbound singleton for the framework
 * sentinel and a fresh `GaussDbSchema` for any other coordinate.
 *
 * The factory has no per-call state — every named id deterministically
 * maps to a distinct schema instance — so callers can pass it through
 * by reference and trust the resulting `SqlStorage.namespaces` map to
 * be value-stable for a given input set. Native-enum column type names are
 * schema-qualified earlier, at column construction, via the target's
 * `authoring.qualifyColumnType` hook (`gaussdbQualifyColumnType`), so this
 * factory just materialises the namespace from already-qualified entries.
 */
export function gaussdbCreateNamespace(input: SqlNamespaceInput): GaussDbSchema {
  const schemaInput: GaussDbSchemaInput = {
    id: input.id,
    entries: {
      ...input.entries,
      table: input.entries['table'] ?? {},
    },
  };
  if (input.id === UNBOUND_NAMESPACE_ID) {
    return new GaussDbUnboundSchema(schemaInput);
  }
  return new GaussDbSchema(schemaInput);
}

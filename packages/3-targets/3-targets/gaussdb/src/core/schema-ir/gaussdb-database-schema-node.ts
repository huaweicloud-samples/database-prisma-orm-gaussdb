import type { DiffableNode } from '@internal/framework-components/control';
import { freezeNode } from '@internal/framework-components/ir';
import { assertNode, SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import type { GaussDbNamespaceSchemaNode } from './gaussdb-namespace-schema-node';
import type { GaussDbRoleSchemaNode } from './gaussdb-role-schema-node';
import { GaussDbSchemaNodeKind } from './schema-node-kinds';

export interface GaussDbDatabaseSchemaNodeInput {
  readonly namespaces: Readonly<Record<string, GaussDbNamespaceSchemaNode>>;
  readonly roles: readonly GaussDbRoleSchemaNode[];
  readonly existingSchemas: readonly string[];
  readonly pgVersion: string;
  /**
   * Whether the live server exposes the RLS state catalogs (`pg_policies` and
   * `pg_class.relrowsecurity`). GaussDB (live-probed 42P01/42703) does not, so
   * its introspected trees can never carry RLS state — the verify verdict
   * grades RLS-shaped drift on such trees as 'observed' (warn) instead of
   * failing on differences it structurally cannot observe. Defaults to true
   * (a stock-PostgreSQL-shaped host keeps grading RLS drift normally).
   */
  readonly rlsStateObservable?: boolean;
}

/**
 * The root of the GaussDB schema-diff tree: one node per database.
 *
 * `id` is the fixed sentinel `'database'` — the root has no siblings and
 * the value is never emitted into migration paths. `isEqualTo` is identity
 * (roots always share the `'database'` id). `children()` yields the namespace
 * nodes followed by the role nodes — both are root-level diff subjects. The
 * differ pairs siblings by `(nodeKind, id)`, so a role and a namespace may
 * share a name without colliding.
 */
export class GaussDbDatabaseSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = GaussDbSchemaNodeKind.database;

  readonly namespaces: Readonly<Record<string, GaussDbNamespaceSchemaNode>>;
  readonly roles: readonly GaussDbRoleSchemaNode[];
  readonly existingSchemas: readonly string[];
  readonly pgVersion: string;
  readonly rlsStateObservable: boolean;

  constructor(input: GaussDbDatabaseSchemaNodeInput) {
    super();
    this.namespaces = Object.freeze({ ...input.namespaces });
    this.roles = Object.freeze([...input.roles]);
    this.existingSchemas = Object.freeze([...input.existingSchemas]);
    this.pgVersion = input.pgVersion;
    this.rlsStateObservable = input.rlsStateObservable ?? true;
    freezeNode(this);
  }

  get id(): string {
    return 'database';
  }

  isEqualTo(other: DiffableNode): boolean {
    return this.id === other.id;
  }

  children(): readonly DiffableNode[] {
    return [...Object.values(this.namespaces), ...this.roles];
  }

  static is(node: SqlSchemaIRNode): node is GaussDbDatabaseSchemaNode {
    return node.nodeKind === GaussDbSchemaNodeKind.database;
  }

  static assert(node: SqlSchemaIRNode): asserts node is GaussDbDatabaseSchemaNode {
    assertNode(node, 'GaussDbDatabaseSchemaNode', GaussDbDatabaseSchemaNode.is);
  }
}

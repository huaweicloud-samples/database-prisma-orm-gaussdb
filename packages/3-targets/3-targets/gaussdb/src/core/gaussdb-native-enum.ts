import type { ControlPolicy } from '@internal/contract/types';
import { freezeNode } from '@internal/framework-components/ir';
import { SqlNode } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';

export interface GaussDbNativeEnumInput<Members extends readonly string[] = readonly string[]> {
  /** The GaussDB type name (`CREATE TYPE <typeName> AS ENUM (…)`). */
  readonly typeName: string;
  /** Member values in declaration order — this is the GaussDB enum sort order. */
  readonly members: Members;
  readonly control?: ControlPolicy;
}

function freezeMembers<Members extends readonly string[]>(members: Members): Members {
  return blindCast<
    Members,
    'Object.freeze clones+freezes the tuple for immutability; the clone widens to readonly string[], but it holds exactly the values of members (already typed Members)'
  >(Object.freeze([...members]));
}

/**
 * GaussDB contract-IR class for a native enum type (`CREATE TYPE … AS ENUM (…)`).
 *
 * This is an authored, serialized Contract-IR entity — it is registered as an entity
 * kind, extends `SqlNode`, and is stored in `contract.json`. It is NOT a DiffableNode;
 * the schema-diff tree will use `GaussDbNativeEnumSchemaNode` when the managed phase
 * builds it.
 *
 * A member is a value, not a name→value pair — matching `CREATE TYPE … AS ENUM
 * ('a', 'b')`, which has no separate member name.
 *
 * Target-only concept — no SQL-family abstract. Extends `SqlNode` directly,
 * frozen at construction via `freezeNode(this)`. The `kind: 'gaussdb-enum'`
 * discriminant is enumerable so it survives JSON. Lives at
 * `storage.namespaces[ns].entries.native_enum[HandleName]`; the entries key
 * (`native_enum`) is the entity-kind descriptor's `kind`, decoupled from this
 * node's own `kind` literal — the same shape as `table`/`StorageTable` and
 * `valueSet`/`StorageValueSet`.
 */
export class GaussDbNativeEnum<
  Members extends readonly string[] = readonly string[],
> extends SqlNode {
  static is(node: unknown): node is GaussDbNativeEnum {
    return (
      typeof node === 'object' && node !== null && 'kind' in node && node.kind === 'gaussdb-enum'
    );
  }

  override readonly kind = 'gaussdb-enum' as const;
  readonly typeName: string;
  readonly members: Members;
  declare readonly control?: ControlPolicy;

  constructor(input: GaussDbNativeEnumInput<Members>) {
    super();
    this.typeName = input.typeName;
    this.members = freezeMembers(input.members);
    if (input.control !== undefined) this.control = input.control;
    freezeNode(this);
  }
}

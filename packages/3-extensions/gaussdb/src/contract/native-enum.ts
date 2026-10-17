import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { PG_ENUM_CODEC_ID } from '@internal/target-gaussdb/codec-ids';
import { pgEnumDescriptor } from '@internal/target-gaussdb/codecs';
import { GaussDbNativeEnum } from '@internal/target-gaussdb/types';
import { InternalError } from '@internal/utils/internal-error';
import { gaussdbError } from '../errors';

/**
 * Handle returned by {@link nativeEnum}. Mirrors PSL's two distinct strings for
 * a `native_enum <Name> { … @@map("type_name") }` block:
 *
 * - `name` — the entity name: the key in `entries.native_enum` /
 *   `entries.valueSet`, and the column's `valueSet` ref `entityName`.
 * - `typeName` — the GaussDB type name (`CREATE TYPE <typeName> AS ENUM (…)`
 *   and the `$N::<typeName>` cast). Defaults to `name`; override with
 *   {@link NativeEnumHandle.map}.
 */
export interface NativeEnumHandle<
  Name extends string = string,
  TypeName extends string = string,
  Members extends readonly [string, ...string[]] = readonly [string, ...string[]],
> {
  readonly entityKind: 'native_enum';
  readonly name: Name;
  readonly typeName: TypeName;
  readonly members: Members;
  readonly entity: GaussDbNativeEnum<Members>;
  /**
   * Overrides the GaussDB type name (PSL's `@@map("type_name")`), keeping the
   * entity `name` unchanged. `nativeEnum('AalLevel', …).map('aal_level')` →
   * entity name `AalLevel`, GaussDB type `aal_level`.
   */
  map<const MappedTypeName extends string>(
    typeName: MappedTypeName,
  ): NativeEnumHandle<Name, MappedTypeName, Members>;
}

function buildNativeEnumHandle<
  Name extends string,
  TypeName extends string,
  Members extends readonly [string, ...string[]],
>(name: Name, typeName: TypeName, members: Members): NativeEnumHandle<Name, TypeName, Members> {
  if (typeName.trim().length === 0) {
    throw gaussdbError(
      'CONTRACT.ENUM_INVALID',
      `nativeEnum("${name}"): the GaussDB type name must be a non-empty string.`,
      {
        fix: 'Pass a non-empty GaussDB type name to .map(typeName).',
        meta: { enumName: name, reason: 'empty type name' },
      },
    );
  }
  return {
    entityKind: 'native_enum',
    name,
    typeName,
    members,
    entity: new GaussDbNativeEnum<Members>({ typeName, members }),
    map: (mappedTypeName) => buildNativeEnumHandle(name, mappedTypeName, members),
  };
}

/**
 * Declares a native GaussDB enum type for use with {@link pg}'s `.enum()`
 * column helper. Mirrors PSL's `native_enum <Name> { … }` lowering
 * (`lowerNativeEnumFromBlock`): validates a non-empty, duplicate-free member
 * list and builds the same {@link GaussDbNativeEnum} entity. Its value-set is
 * derived generically at contract-build time — the same
 * `deriveValueSetFromEntity` fold PSL's native enums go through — once
 * `pg.enum(handle)` lands the entity in the field's owning namespace.
 *
 * The first argument is the entity `name` (the `entries.native_enum` /
 * `entries.valueSet` key). The GaussDB type name defaults to `name`; use
 * `.map(typeName)` to override it (PSL's `@@map`).
 *
 * A handle referenced by columns in N different namespaces materialises N
 * native enum types (one per namespace) — by design: a GaussDB type lives in
 * exactly one schema, and PSL can't share a type across schemas either.
 *
 * @example
 * ```ts
 * // name === GaussDB type name
 * const Role = nativeEnum('Role', 'user', 'admin');
 * // entity name `AalLevel`, GaussDB type `aal_level` (Supabase's auth.aal_level)
 * const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');
 * model('Session', { fields: { aal: field.column(pg.enum(AalLevel)).optional() } });
 * ```
 */
export function nativeEnum<
  const Name extends string,
  const Members extends readonly [string, ...string[]],
>(name: Name, ...members: Members): NativeEnumHandle<Name, Name, Members> {
  if (name.trim().length === 0) {
    throw gaussdbError('CONTRACT.ENUM_INVALID', 'nativeEnum(): name must be a non-empty string.', {
      fix: 'Pass a non-empty entity name as the first argument to nativeEnum().',
      meta: { enumName: name, reason: 'empty name' },
    });
  }
  if (members.length === 0) {
    throw gaussdbError(
      'CONTRACT.ENUM_INVALID',
      `nativeEnum("${name}"): must have at least one member.`,
      {
        why: 'GaussDB rejects CREATE TYPE ... AS ENUM () with no labels.',
        fix: 'Declare at least one member value after the name.',
        meta: { enumName: name, reason: 'zero members' },
      },
    );
  }

  const seenValues = new Set<string>();
  for (const value of members) {
    if (seenValues.has(value)) {
      throw gaussdbError(
        'CONTRACT.ENUM_INVALID',
        `nativeEnum("${name}"): duplicate member value "${value}". Member values must be unique.`,
        {
          fix: 'Remove the duplicate member value.',
          meta: { enumName: name, member: value, reason: 'duplicate member value' },
        },
      );
    }
    seenValues.add(value);
  }

  return buildNativeEnumHandle(name, name, members);
}

/**
 * The descriptor `pg.enum(handle)` returns: an `entityRef.entity` typed to the
 * handle's own `GaussDbNativeEnum<Members>`, so the member-value literal
 * tuple survives on the descriptor type instead of widening to `unknown`.
 */
type PgEnumColumnDescriptor<Members extends readonly [string, ...string[]]> = ColumnTypeDescriptor<
  typeof PG_ENUM_CODEC_ID
> & {
  readonly entityRef: {
    readonly entityKind: 'native_enum';
    readonly entityName: string;
    readonly entity: GaussDbNativeEnum<Members>;
  };
};

/**
 * Builds the deferred column descriptor for `handle`: the bare GaussDB type
 * name and `typeParams` come from `pgEnumDescriptor.columnFromEntity` (the same
 * authoring hook the PSL `pg.enum(Ref)` type constructor resolves through),
 * carrying `handle.entity` as the descriptor's `entityRef` keyed by the entity
 * `name` (not the GaussDB type name — they differ when `.map()` was used).
 * Schema qualification and the storage `valueSet` ref are NOT computed here — a
 * `field.column(pg.enum(handle))` call runs before the enclosing `model(...)`
 * associates a namespace, so `buildSqlContractFromDefinition` resolves both
 * once the field's namespace is known.
 */
function pgEnumColumn<
  const Name extends string,
  const TypeName extends string,
  const Members extends readonly [string, ...string[]],
>(handle: NativeEnumHandle<Name, TypeName, Members>): PgEnumColumnDescriptor<Members> {
  const resolved = pgEnumDescriptor.columnFromEntity(handle.entity);
  if (resolved === undefined) {
    throw new InternalError(
      `pg.enum("${handle.name}"): handle.entity is not a GaussDbNativeEnum. This is an authoring-surface bug — nativeEnum() must always produce one.`,
    );
  }
  return {
    codecId: PG_ENUM_CODEC_ID,
    nativeType: resolved.nativeType,
    typeParams: resolved.typeParams,
    entityRef: {
      entityKind: handle.entityKind,
      entityName: handle.name,
      entity: handle.entity,
    },
  };
}

/** GaussDB-specific TS type-constructor namespace, mirroring the PSL `pg.` prefix. */
export const pg = {
  enum: pgEnumColumn,
} as const;

/**
 * GaussDB native-type normalization.
 *
 * Lives in `target-gaussdb` because both the migration planner/runner (control
 * plane) and the introspection adapter (control plane) need to normalize raw
 * native-type strings to the same canonical form for comparison.
 */

/**
 * Lookup map for simple prefix-based type normalization.
 *
 * Using a Map for O(1) lookup instead of multiple startsWith checks.
 */
const TYPE_PREFIX_MAP: ReadonlyMap<string, string> = new Map([
  ['varchar', 'character varying'],
  ['bpchar', 'character'],
  ['varbit', 'bit varying'],
]);

/**
 * Normalizes a GaussDB schema native type to its canonical form for comparison.
 *
 * Uses a pre-computed lookup map for simple prefix replacements (O(1))
 * and handles complex temporal type normalization separately.
 */
export function normalizeSchemaNativeType(nativeType: string): string {
  const trimmed = nativeType.trim();

  for (const [prefix, replacement] of TYPE_PREFIX_MAP) {
    if (trimmed.startsWith(prefix)) {
      return replacement + trimmed.slice(prefix.length);
    }
  }

  if (trimmed.includes(' with time zone')) {
    if (trimmed.startsWith('timestamp')) {
      return `timestamptz${trimmed.slice(9).replace(' with time zone', '')}`;
    }
    if (trimmed.startsWith('time')) {
      return `timetz${trimmed.slice(4).replace(' with time zone', '')}`;
    }
  }

  if (trimmed.includes(' without time zone')) {
    return trimmed.replace(' without time zone', '');
  }

  return trimmed;
}

/**
 * Alias map for the Oracle-compat authoring type names that GaussDB stores
 * under catalog aliases: `number` lands as `numeric` and `varchar2` as
 * `character varying` (live-probed format_type output), so the expected-tree
 * comparison values must carry the catalog spelling to match introspection
 * while DDL rendering keeps the authoring name (the DDL path re-derives from
 * the column's codec identity and is unaffected by this map).
 */
const INTROSPECTION_TYPE_ALIASES: ReadonlyMap<string, string> = new Map([
  ['number', 'numeric'],
  ['varchar2', 'character varying'],
]);

/**
 * Maps an expanded native type (authoring spelling, optional parameters,
 * optional `[]`) to the form GaussDB introspection reports back. `raw`'s
 * length parameter does not survive `format_type` (raw(16) reads back bare
 * `raw`), so it is stripped as well. Everything else passes through.
 */
export function toIntrospectedNativeType(nativeType: string): string {
  const arraySuffix = nativeType.endsWith('[]') ? '[]' : '';
  const base = arraySuffix ? nativeType.slice(0, -2) : nativeType;
  const parenIndex = base.indexOf('(');
  const bare = (parenIndex === -1 ? base : base.slice(0, parenIndex)).trimEnd();
  if (bare === 'raw') {
    return `raw${arraySuffix}`;
  }
  const alias = INTROSPECTION_TYPE_ALIASES.get(bare);
  if (alias === undefined) {
    return nativeType;
  }
  return `${alias}${parenIndex === -1 ? '' : base.slice(parenIndex)}${arraySuffix}`;
}

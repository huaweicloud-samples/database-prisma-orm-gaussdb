import {
  bindEnumType,
  type ExtractCodecTypesFromPack,
} from '@internal/sql-contract-ts/contract-builder';
import type gaussdbPack from '@internal/target-gaussdb/pack';

type GaussDbCodecTypes = ExtractCodecTypesFromPack<typeof gaussdbPack>;

/**
 * The `enumType` authors call when building a GaussDB contract (re-exported
 * from `@internal/gaussdb/contract-builder`).
 *
 * `bindEnumType` is the core, codec-agnostic `enumType` factory; calling it with
 * the GaussDB pack's codec typemap fixes which member-value type each codec
 * permits, so `member()` values are checked against the column's codec at
 * authoring time: `pg/text@1` requires `string`, `pg/int4@1` requires `number`,
 * and a mismatch is a compile error. The core `enumType` can't know the codec
 * set, which is why the binding happens here, per target.
 */
export const enumType = bindEnumType<GaussDbCodecTypes>();

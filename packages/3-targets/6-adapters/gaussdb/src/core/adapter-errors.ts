import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

type RuntimeSubcode =
  | 'DDL_UNSUPPORTED'
  | 'RAW_SQL_UNSUPPORTED_INTERPOLATION'
  | 'TYPE_PARAMS_INVALID'
  | 'PARAM_REF_MISSING_CODEC'
  | 'NAMESPACE_UNKNOWN'
  | 'AST_INVALID'
  | 'POLICY_UNSUPPORTED';

type ContractSubcode =
  | 'INTROSPECTION_UNSUPPORTED'
  | 'DEFAULT_INVALID'
  | 'PACK_CONTRIBUTION_INVALID';

export type GaussDbAdapterErrorCode = `RUNTIME.${RuntimeSubcode}` | `CONTRACT.${ContractSubcode}`;

export function adapterError(
  code: GaussDbAdapterErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}

import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { ReferentialAction } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import type { GaussDbPlanTargetDetails, OperationClass } from '../planner-target-details';

export type Op = SqlMigrationPlanOperation<GaussDbPlanTargetDetails>;

/**
 * Literal-args shape for a foreign key definition. `references.schema`
 * carries the target table's namespace (schema) coordinate so the rendered
 * DDL qualifies the REFERENCES clause correctly for cross-schema FKs.
 */
export interface ForeignKeySpec {
  readonly name: string;
  readonly columns: readonly string[];
  readonly references: {
    readonly schema: string;
    readonly table: string;
    readonly columns: readonly string[];
  };
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
}

export function step(description: string, sql: string, params?: readonly unknown[]) {
  return { description, sql, ...ifDefined('params', params) };
}

export function targetDetails(
  objectType: OperationClass,
  name: string,
  schema: string,
  table?: string,
): { readonly id: 'gaussdb'; readonly details: GaussDbPlanTargetDetails } {
  return {
    id: 'gaussdb',
    details: { schema, objectType, name, ...ifDefined('table', table) },
  };
}

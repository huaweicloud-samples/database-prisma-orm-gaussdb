import { ifDefined } from '@internal/utils/defined';

export type OperationClass =
  | 'dependency'
  | 'type'
  | 'table'
  | 'column'
  | 'primaryKey'
  | 'unique'
  | 'index'
  | 'foreignKey'
  | 'checkConstraint'
  | 'rlsPolicy'
  | 'rowLevelSecurity';

export interface GaussDbPlanTargetDetails {
  readonly schema: string;
  readonly objectType: OperationClass;
  readonly name: string;
  readonly table?: string;
}

export function buildTargetDetails(
  objectType: OperationClass,
  name: string,
  schema: string,
  table?: string,
): GaussDbPlanTargetDetails {
  return {
    schema,
    objectType,
    name,
    ...ifDefined('table', table),
  };
}

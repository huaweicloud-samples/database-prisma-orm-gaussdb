import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { ifDefined } from '@internal/utils/defined';
import { nativeEnumTypeExistsAst } from '../../../contract-free/checks';
import { createType, dropType } from '../../../contract-free/ddl';
import { validateEnumValueLength } from '../../sql-utils';
import { boundSchema } from '../bound-schema';
import { type Op, step, targetDetails } from './shared';

/**
 * `CREATE TYPE <qualified> AS ENUM (…)` for a managed native enum, built as a
 * typed DDL node and lowered by the control adapter (the type name is quoted,
 * member values render as escaped string literals in declaration order —
 * GaussDB enum sort order is semantic). `boundSchema` maps the unbound sentinel
 * to an absent schema so the type name renders unqualified and the connection's
 * `search_path` resolves the schema at runtime.
 */
export async function createNativeEnumType(
  schemaName: string,
  typeName: string,
  members: readonly string[],
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  for (const member of members) {
    validateEnumValueLength(member, typeName);
  }
  const ddlNode = createType({
    ...ifDefined('schema', boundSchema(schemaName)),
    name: typeName,
    values: members,
  });
  const statement = await lowerer.lowerToExecuteRequest(ddlNode);
  const checks = nativeEnumTypeExistsAst(schemaName, typeName);
  const absent = await lowerer.lowerToExecuteRequest(checks.typeAbsent());
  const present = await lowerer.lowerToExecuteRequest(checks.typePresent());
  return {
    id: `createNativeEnumType.${typeName}`,
    label: `Create enum type "${typeName}"`,
    operationClass: 'additive',
    target: targetDetails('type', typeName, schemaName),
    precheck: [step(`ensure enum type "${typeName}" does not exist`, absent.sql, absent.params)],
    execute: [step(`create enum type "${typeName}"`, statement.sql, statement.params)],
    postcheck: [step(`verify enum type "${typeName}" exists`, present.sql, present.params)],
  };
}

/** `DROP TYPE <qualified>` for an unclaimed managed native enum, via typed DDL. */
export async function dropNativeEnumType(
  schemaName: string,
  typeName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const ddlNode = dropType({
    ...ifDefined('schema', boundSchema(schemaName)),
    name: typeName,
  });
  const statement = await lowerer.lowerToExecuteRequest(ddlNode);
  const checks = nativeEnumTypeExistsAst(schemaName, typeName);
  const present = await lowerer.lowerToExecuteRequest(checks.typePresent());
  const absent = await lowerer.lowerToExecuteRequest(checks.typeAbsent());
  return {
    id: `dropNativeEnumType.${typeName}`,
    label: `Drop enum type "${typeName}"`,
    operationClass: 'destructive',
    target: targetDetails('type', typeName, schemaName),
    precheck: [step(`ensure enum type "${typeName}" exists`, present.sql, present.params)],
    execute: [step(`drop enum type "${typeName}"`, statement.sql, statement.params)],
    postcheck: [step(`verify enum type "${typeName}" does not exist`, absent.sql, absent.params)],
  };
}

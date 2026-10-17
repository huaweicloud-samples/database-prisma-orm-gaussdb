import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { ifDefined } from '@internal/utils/defined';
import {
  alterPolicyRename,
  createPolicy,
  disableRowLevelSecurity as disableRowLevelSecurityDdl,
} from '../../../contract-free/ddl';
import { gaussdbError } from '../../errors';
import type { GaussDbRlsPolicy } from '../../gaussdb-rls-policy';
import { quoteIdentifier } from '../../sql-utils';
import { qualifyTableName } from '../planner-sql-checks';
import { type Op, step, targetDetails } from './shared';

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

function validateRoleName(role: string): string {
  if (!PLAIN_IDENTIFIER.test(role)) {
    throw gaussdbError(
      'CONTRACT.ROLE_INVALID',
      `Invalid role name ${JSON.stringify(role)}: role names must be plain SQL identifiers matching ^[A-Za-z_][A-Za-z0-9_$]*$`,
      { meta: { role, reason: 'not-a-plain-identifier' } },
    );
  }
  return role;
}

function dropPolicyIfExistsStep(
  schemaName: string,
  tableName: string,
  policyName: string,
): { description: string; sql: string } {
  return {
    description: `clear existing RLS policy "${policyName}" if present`,
    sql: `DROP POLICY IF EXISTS ${quoteIdentifier(policyName)} ON ${qualifyTableName(schemaName, tableName)}`,
  };
}

/**
 * RLS ops on GaussDB carry no catalog checks: neither `pg_policies` nor the
 * `pg_class.relrowsecurity` column exists on it (42P01/42703, live-probed),
 * so policy existence and enablement are unobservable and any check SQL
 * referencing them would abort the op at parse time. Idempotence instead
 * rides dialect-verified forms — `DROP POLICY IF EXISTS` and the server-side
 * idempotence of repeated `ALTER TABLE … ENABLE/FORCE/DISABLE ROW LEVEL
 * SECURITY` (see probe/gaussdb_migration_ops_probe*.py, 2026-10-15).
 */
export async function createRlsPolicy(
  schemaName: string,
  tableName: string,
  policy: GaussDbRlsPolicy,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const validatedRoles = policy.roles.map(validateRoleName);
  const ddlNode = createPolicy({
    schema: schemaName,
    table: tableName,
    name: policy.name,
    permissive: policy.permissive,
    operation: policy.operation,
    roles: validatedRoles,
    ...ifDefined('using', policy.using),
    ...ifDefined('withCheck', policy.withCheck),
  });
  const execute = await lowerer.lowerToExecuteRequest(ddlNode);
  return {
    id: `rlsPolicy.${schemaName}.${tableName}.${policy.name}`,
    label: `Create RLS policy "${policy.name}" on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('rlsPolicy', policy.name, schemaName, tableName),
    precheck: [],
    execute: [
      dropPolicyIfExistsStep(schemaName, tableName, policy.name),
      step(`create RLS policy "${policy.name}"`, execute.sql, execute.params),
    ],
    postcheck: [],
  };
}

export async function dropRlsPolicy(
  schemaName: string,
  tableName: string,
  policyName: string,
): Promise<Op> {
  return {
    id: `rlsPolicy.${schemaName}.${tableName}.${policyName}.drop`,
    label: `Drop RLS policy "${policyName}" on "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('rlsPolicy', policyName, schemaName, tableName),
    precheck: [],
    execute: [
      step(
        `drop RLS policy "${policyName}"`,
        dropPolicyIfExistsStep(schemaName, tableName, policyName).sql,
      ),
    ],
    postcheck: [],
  };
}

export async function enableRowLevelSecurity(schemaName: string, tableName: string): Promise<Op> {
  return {
    id: `rowLevelSecurity.${schemaName}.${tableName}`,
    label: `Enable row-level security on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('rowLevelSecurity', tableName, schemaName),
    precheck: [],
    execute: [
      step(
        `enable row-level security on "${tableName}"`,
        `ALTER TABLE ${qualifyTableName(schemaName, tableName)} ENABLE ROW LEVEL SECURITY`,
      ),
    ],
    postcheck: [],
  };
}

export async function disableRowLevelSecurity(
  schemaName: string,
  tableName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const ddlNode = disableRowLevelSecurityDdl({ schema: schemaName, table: tableName });
  const execute = await lowerer.lowerToExecuteRequest(ddlNode);
  return {
    id: `rowLevelSecurity.${schemaName}.${tableName}.disable`,
    label: `Disable row-level security on "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('rowLevelSecurity', tableName, schemaName),
    precheck: [],
    execute: [step(`disable row-level security on "${tableName}"`, execute.sql, execute.params)],
    postcheck: [],
  };
}

export async function renameRlsPolicy(
  schemaName: string,
  tableName: string,
  oldPolicyName: string,
  newPolicyName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const ddlNode = alterPolicyRename({
    schema: schemaName,
    table: tableName,
    name: oldPolicyName,
    newName: newPolicyName,
  });
  const execute = await lowerer.lowerToExecuteRequest(ddlNode);
  return {
    id: `rlsPolicy.${schemaName}.${tableName}.${oldPolicyName}.rename`,
    label: `Rename RLS policy "${oldPolicyName}" to "${newPolicyName}" on "${tableName}"`,
    operationClass: 'widening',
    target: targetDetails('rlsPolicy', newPolicyName, schemaName, tableName),
    precheck: [],
    execute: [
      step(
        `rename RLS policy "${oldPolicyName}" to "${newPolicyName}"`,
        execute.sql,
        execute.params,
      ),
    ],
    postcheck: [],
  };
}

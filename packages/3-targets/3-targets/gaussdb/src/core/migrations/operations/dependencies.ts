import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { extensionExistsAst } from '../../../contract-free/checks';
import { DEFAULT_NAMESPACE_ID } from '../../namespace-ids';
import { quoteIdentifier } from '../../sql-utils';
import { type Op, step } from './shared';

/**
 * Bare `CREATE EXTENSION` (the `IF NOT EXISTS` clause is stripped — GaussDB
 * gates extensions behind an instance-level `enable_extension` GUC and may
 * not carry the clause at all) guarded by parameterized `pg_extension`
 * probes. This is the planner/user-authoring surface — sync, no lowerer
 * required, so the probes are raw param-bound SQL steps rather than lowered
 * ASTs; `installExtension` below is the lowerer-backed variant for
 * contract-space baseline migrations.
 */
export function createExtension(extensionName: string): Op {
  return {
    id: `extension.${extensionName}`,
    label: `Create extension "${extensionName}"`,
    operationClass: 'additive',
    target: { id: 'gaussdb' },
    precheck: [
      step(
        `ensure extension "${extensionName}" is not already enabled`,
        'SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = $1) AS "result"',
        [extensionName],
      ),
    ],
    execute: [
      step(
        `Create extension "${extensionName}"`,
        `CREATE EXTENSION ${quoteIdentifier(extensionName)}`,
      ),
    ],
    postcheck: [
      step(
        `confirm extension "${extensionName}" is enabled`,
        'SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = $1) AS "result"',
        [extensionName],
      ),
    ],
  };
}

/**
 * Install a GaussDB extension as the baseline op for an extension-pack
 * contract space. Layered on top of {@link createExtension}: stamps an
 * `invariantId` (required so the per-space marker records the install),
 * scopes the op `id` under a caller-chosen namespace (e.g. `pgvector.`),
 * and emits pre- and postcheck SQL probing `pg_extension`. The richer
 * shape lets the runner's idempotency probe skip the install on re-run
 * (postcheck-pre-satisfied) without firing the precheck.
 *
 * Use this for hand-rolled baseline migrations in contract-space
 * extension packages (e.g. `extension-pgvector`, `extension-paradedb`);
 * use the bare {@link createExtension} for planner-emitted ops where the
 * caller already controls idempotency through the surrounding plan.
 */
export async function installExtension(
  options: {
    readonly extensionName: string;
    readonly invariantId: string;
    readonly id: string;
    readonly label?: string;
  },
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const { extensionName, invariantId, id } = options;
  const label = options.label ?? `Enable extension "${extensionName}"`;
  const checks = extensionExistsAst(extensionName);
  const absent = await lowerer.lowerToExecuteRequest(checks.extensionAbsent());
  const present = await lowerer.lowerToExecuteRequest(checks.extensionPresent());
  return {
    id,
    label,
    operationClass: 'additive',
    invariantId,
    target: {
      id: 'gaussdb',
      details: { schema: DEFAULT_NAMESPACE_ID, objectType: 'dependency', name: extensionName },
    },
    precheck: [
      step(`verify extension "${extensionName}" is not already enabled`, absent.sql, absent.params),
    ],
    execute: [step(`create extension "${extensionName}"`, `CREATE EXTENSION ${extensionName}`)],
    postcheck: [
      step(`confirm extension "${extensionName}" is enabled`, present.sql, present.params),
    ],
  };
}

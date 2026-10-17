import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { MigrationPlanOperation, OpFactoryCall } from '@internal/framework-components/control';
import { blindCast } from '@internal/utils/casts';
import { isThenable } from '@internal/utils/promise';
import { gaussdbError } from '../errors';
import type { GaussDbPlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<GaussDbPlanTargetDetails>;

/**
 * Asserts an op materialised by an `OpFactoryCall` targets gaussdb. The
 * extension surface lets any contributor emit calls, so this is the
 * integration boundary where a stray non-gaussdb op would otherwise
 * silently flow through to gaussdb-shaped renderers — exactly the
 * place to fail loudly with op metadata (`id` + `target.id`).
 */
function assertGaussDbOp(op: MigrationPlanOperation, callFactoryName: string): asserts op is Op {
  const targetId = blindCast<
    { target?: { id?: string } },
    'op.target is present on concrete SqlMigrationPlanOperation but absent on the framework MigrationPlanOperation base'
  >(op).target?.id;
  if (targetId !== 'gaussdb') {
    throw gaussdbError(
      'MIGRATION.TARGET_MISMATCH',
      `renderOps: expected gaussdb op but got target.id="${String(targetId)}" for op.id="${op.id}" (factoryName="${callFactoryName}"). An OpFactoryCall produced an op for a different target on the gaussdb planner path; check the call's target binding.`,
      { meta: { opId: op.id, targetId: String(targetId), factoryName: callFactoryName } },
    );
  }
}

export function renderOps(
  calls: readonly OpFactoryCall[],
  lowerer?: ExecuteRequestLowerer,
): (Op | Promise<Op>)[] {
  return calls.map((c) => {
    const opOrPromise = blindCast<
      { toOp(lowerer?: ExecuteRequestLowerer): Op | Promise<Op> },
      'PG OpFactoryCall.toOp accepts an optional ExecuteRequestLowerer; the framework interface omits it because not all targets need a lowerer — the PG target overrides with this extended signature'
    >(c).toOp(lowerer);
    if (isThenable(opOrPromise)) {
      return opOrPromise.then((op) => {
        assertGaussDbOp(op, c.factoryName);
        return op;
      });
    }
    assertGaussDbOp(opOrPromise, c.factoryName);
    return opOrPromise;
  });
}

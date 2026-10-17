import sqlFamilyDescriptor from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import type {
  RuntimeExtensionDescriptor,
  RuntimeTargetDescriptor,
} from '@internal/framework-components/execution';
import gaussdbTargetControlDescriptor from '@internal/target-gaussdb/control';
import gaussdbAdapterControlDescriptor from '../../src/exports/control';
import gaussdbRuntimeAdapterDescriptor from '../../src/exports/runtime';

const stubRuntimeTarget: RuntimeTargetDescriptor<'sql', 'gaussdb'> = {
  kind: 'target',
  id: 'gaussdb',
  version: '0.0.1',
  familyId: 'sql',
  targetId: 'gaussdb',
  create() {
    return { familyId: 'sql', targetId: 'gaussdb' };
  },
};

/**
 * Build a stack-composed GaussDB runtime adapter for tests that exercise
 * extension codecs (e.g. `gaussdb/vector@1`). The bare `createGaussDbAdapter()`
 * factory cannot see extension codecs by design (ADR 205), so any test that
 * lowers a `ParamRef` carrying an extension-codec id must compose a stack
 * with the relevant extension pack(s).
 */
export function createComposedGaussDbAdapter(options: {
  readonly extensions: readonly RuntimeExtensionDescriptor<'sql', 'gaussdb'>[];
}) {
  return gaussdbRuntimeAdapterDescriptor.create({
    target: stubRuntimeTarget,
    adapter: gaussdbRuntimeAdapterDescriptor,
    driver: undefined,
    extensions: options.extensions,
  });
}

/**
 * Build a stack-composed GaussDB control adapter for tests that exercise
 * extension codecs. Goes through the public `create(stack)` factory on the
 * adapter's control descriptor (same path `exports/control.ts` uses in
 * production) to keep the test helper aligned with the codebase's
 * "factories not classes" coding convention. Composes against the real SQL
 * family / gaussdb target / gaussdb adapter control descriptors so the
 * codec lookup is assembled from the same metadata sources production uses.
 */
export function createComposedGaussDbControlAdapter(options: {
  readonly extensions: readonly ControlExtensionDescriptor<'sql', 'gaussdb'>[];
}): SqlControlAdapter<'gaussdb'> {
  const stack = createControlStack({
    family: sqlFamilyDescriptor,
    target: gaussdbTargetControlDescriptor,
    adapter: gaussdbAdapterControlDescriptor,
    extensions: options.extensions,
  });
  return gaussdbAdapterControlDescriptor.create(stack) as SqlControlAdapter<'gaussdb'>;
}

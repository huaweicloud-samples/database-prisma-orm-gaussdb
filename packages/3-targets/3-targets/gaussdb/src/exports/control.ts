import type { ColumnDefault } from '@internal/contract/types';
import type { SqlControlTargetDescriptor } from '@internal/family-sql/control';
import { buildNativeTypeExpander } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type {
  ControlTargetInstance,
  MigrationRunner,
} from '@internal/framework-components/control';
import type { StorageColumn } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { gaussdbResolveDefault } from '../core/default-normalizer';
import { gaussdbTargetDescriptorMeta } from '../core/descriptor-meta';
import { GaussDbContractSerializer } from '../core/gaussdb-contract-serializer';
import type { GaussDbContract } from '../core/gaussdb-schema';
import { GaussDbSchemaVerifier } from '../core/gaussdb-schema-verifier';
import { contractToGaussDbDatabaseSchemaNode } from '../core/migrations/contract-to-gaussdb-database-schema-node';
import { diffGaussDbSchema } from '../core/migrations/diff-database-schema';
import { createGaussDbMigrationPlanner } from '../core/migrations/planner';
import { renderDefaultLiteral } from '../core/migrations/planner-ddl-builders';
import type { GaussDbPlanTargetDetails } from '../core/migrations/planner-target-details';
import { createGaussDbMigrationRunner } from '../core/migrations/runner';
import { inferGaussDbPslContract } from '../core/psl-infer/infer-psl-contract';
import { GaussDbDatabaseSchemaNode } from '../core/schema-ir/gaussdb-database-schema-node';
import {
  gaussdbDiffSubjectEntityKind,
  gaussdbDiffSubjectGranularity,
} from '../core/schema-ir/schema-node-kinds';

export function gaussdbRenderDefault(def: ColumnDefault, column: StorageColumn): string {
  if (def.kind === 'function') {
    return def.expression;
  }
  return renderDefaultLiteral(def.value, column);
}

const gaussdbTargetDescriptor: SqlControlTargetDescriptor<'gaussdb', GaussDbPlanTargetDetails> = {
  ...gaussdbTargetDescriptorMeta,
  contractSerializer: new GaussDbContractSerializer(),
  schemaVerifier: new GaussDbSchemaVerifier(),
  inferPslContract(schema, describedContracts) {
    GaussDbDatabaseSchemaNode.assert(schema);
    return inferGaussDbPslContract(schema, describedContracts);
  },
  diffSchema(input) {
    return diffGaussDbSchema(input);
  },
  classifySubjectGranularity: gaussdbDiffSubjectGranularity,
  classifyEntityKind: gaussdbDiffSubjectEntityKind,
  migrations: {
    createPlanner(adapter: SqlControlAdapter<'gaussdb'>) {
      return createGaussDbMigrationPlanner(adapter);
    },
    createRunner(family) {
      return createGaussDbMigrationRunner(family) as MigrationRunner<'sql', 'gaussdb'>;
    },
    contractToSchema(contract, frameworkComponents) {
      const expander = buildNativeTypeExpander(frameworkComponents);
      const gaussdbContract = blindCast<
        GaussDbContract | null,
        'the family resolver only binds this hook for a GaussDB-target contract'
      >(contract);
      return contractToGaussDbDatabaseSchemaNode(gaussdbContract, {
        annotationNamespace: 'pg',
        ...ifDefined('expandNativeType', expander),
        renderDefault: gaussdbRenderDefault,
        resolveDefault: gaussdbResolveDefault,
      });
    },
  },
  create(): ControlTargetInstance<'sql', 'gaussdb'> {
    return {
      familyId: 'sql',
      targetId: 'gaussdb',
    };
  },
  /**
   * Direct method for SQL-specific usage.
   * @deprecated Use migrations.createPlanner() for CLI compatibility.
   */
  createPlanner(adapter: SqlControlAdapter<'gaussdb'>) {
    return createGaussDbMigrationPlanner(adapter);
  },
  /**
   * Direct method for SQL-specific usage.
   * @deprecated Use migrations.createRunner() for CLI compatibility.
   */
  createRunner(family) {
    return createGaussDbMigrationRunner(family);
  },
};

export {
  INSTANT_NOW_GENERATOR_ID,
  instantNowControlDescriptor,
} from '../core/instant-now-generator';

export default gaussdbTargetDescriptor;

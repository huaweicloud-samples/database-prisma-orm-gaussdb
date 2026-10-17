import sqlFamilyPack from '@internal/family-sql/pack';
import type { ExtensionPackRef } from '@internal/framework-components/components';
import type {
  SqlNamespaceBase,
  SqlNamespaceInput,
  StorageTypeInstance,
} from '@internal/sql-contract/types';
import type {
  ComposedAuthoringHelpers,
  ContractInput,
  EnumTypeHandle,
  MergeEnums,
  ModelLike,
} from '@internal/sql-contract-ts/contract-builder';
import { buildBoundContract } from '@internal/sql-contract-ts/contract-builder';
import gaussdbPack from '@internal/target-gaussdb/pack';
import { gaussdbCreateNamespace } from '@internal/target-gaussdb/types';
import type { RlsEntityHandle } from './rls';

type SqlFamily = typeof sqlFamilyPack;
type GaussDbPack = typeof gaussdbPack;

type TypesConstraint = Record<string, StorageTypeInstance>;
type ModelsConstraint = Record<string, ModelLike>;
type EnumsConstraint = Record<string, EnumTypeHandle>;

type GaussDbResult<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
> = ReturnType<
  typeof buildBoundContract<
    SqlFamily,
    GaussDbPack,
    {
      readonly types?: Types;
      readonly models?: Models;
      readonly extensions?: Extensions;
      readonly enums?: Enums;
      readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
    }
  >
>;

type GaussDbBaseScaffold<
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = Omit<
  ContractInput<SqlFamily, GaussDbPack, Record<never, never>, Record<never, never>, Extensions>,
  'family' | 'target' | 'types' | 'models' | 'enums' | 'createNamespace' | 'entities'
> & {
  /**
   * RLS handles (`policy*`, `rlsEnabled`, `role`), lowered by the generic
   * contract build through the gaussdb pack's entity-handle hook —
   * mirroring the PSL `policy_*` / `@@rls` lowering key-for-key and
   * wire-name-for-wire-name. This wrapper only narrows the element type;
   * it contains no entity-kind logic.
   */
  readonly entities?: readonly RlsEntityHandle[];
};

type GaussDbDefinition<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
> = GaussDbBaseScaffold<Extensions> & {
  readonly types?: Types;
  readonly models?: Models;
  readonly enums?: Enums;
};

type GaussDbScaffold<
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
> = GaussDbBaseScaffold<Extensions> & {
  readonly types?: never;
  readonly models?: never;
  readonly enums?: Enums;
};

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const Enums extends EnumsConstraint = Record<never, never>,
>(
  definition: GaussDbDefinition<Types, Models, Extensions, Enums>,
): GaussDbResult<Types, Models, Extensions, Enums>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const ScaffoldEnums extends EnumsConstraint = Record<never, never>,
  const FactoryEnums extends EnumsConstraint = Record<never, never>,
>(
  scaffold: GaussDbScaffold<Extensions, ScaffoldEnums>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, GaussDbPack, Extensions>) => {
    readonly types?: Types;
    readonly models?: Models;
    readonly enums?: FactoryEnums;
  },
): GaussDbResult<Types, Models, Extensions, MergeEnums<ScaffoldEnums, FactoryEnums>>;

// Implementation — delegates to buildBoundContract which pre-binds family/target,
// carrying zero casts and zero entity-kind logic at this layer: the generic
// build lowers `entities` through the pack-registered entity-handle hook.
export function defineContract(
  definition: GaussDbDefinition<TypesConstraint, ModelsConstraint, undefined, EnumsConstraint>,
  factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, GaussDbPack, undefined>) => {
    readonly types?: TypesConstraint;
    readonly models?: ModelsConstraint;
    readonly enums?: EnumsConstraint;
  },
): GaussDbResult<TypesConstraint, ModelsConstraint, undefined, EnumsConstraint> {
  const bound = { ...definition, createNamespace: gaussdbCreateNamespace };
  if (factory !== undefined) {
    return buildBoundContract(sqlFamilyPack, gaussdbPack, bound, factory);
  }
  return buildBoundContract(sqlFamilyPack, gaussdbPack, bound);
}

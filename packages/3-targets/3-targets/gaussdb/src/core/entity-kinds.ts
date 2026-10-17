import type { EntityKindDescriptor } from '@internal/framework-components/ir';
import { GaussDbNativeEnum, type GaussDbNativeEnumInput } from './gaussdb-native-enum';
import { GaussDbRlsEnablement, type GaussDbRlsEnablementInput } from './gaussdb-rls-enablement';
import { GaussDbRlsPolicy } from './gaussdb-rls-policy';
import { GaussDbRole, type GaussDbRoleInput } from './gaussdb-role';
import {
  GaussDbNativeEnumSchema,
  GaussDbRlsEnablementSchema,
  GaussDbRlsPolicySchema,
  GaussDbRoleSchema,
} from './gaussdb-validators';
import { policyInputFromSerialized, type SerializedRlsPolicy } from './serialized-rls-policy';

export const policyEntityKind: EntityKindDescriptor<SerializedRlsPolicy, GaussDbRlsPolicy> = {
  kind: 'policy',
  schema: GaussDbRlsPolicySchema,
  construct: (input) => new GaussDbRlsPolicy(policyInputFromSerialized(input)),
};

export const roleEntityKind: EntityKindDescriptor<GaussDbRoleInput, GaussDbRole> = {
  kind: 'role',
  schema: GaussDbRoleSchema,
  construct: (input) => new GaussDbRole(input),
};

export const rlsEnablementEntityKind: EntityKindDescriptor<
  GaussDbRlsEnablementInput,
  GaussDbRlsEnablement
> = {
  kind: 'rls',
  schema: GaussDbRlsEnablementSchema,
  construct: (input) => new GaussDbRlsEnablement(input),
};

export const nativeEnumEntityKind: EntityKindDescriptor<GaussDbNativeEnumInput, GaussDbNativeEnum> =
  {
    kind: 'native_enum',
    schema: GaussDbNativeEnumSchema,
    construct: (input) => new GaussDbNativeEnum(input),
  };

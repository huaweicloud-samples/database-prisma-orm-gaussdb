import type { CodecTypes } from '../exports/codec-types';
import {
  gaussdbAuthoringEntityTypes,
  gaussdbAuthoringFieldPresets,
  gaussdbAuthoringModelAttributes,
  gaussdbAuthoringPslBlockDescriptors,
  gaussdbAuthoringTypes,
  gaussdbLowerEntityHandles,
} from './authoring';
import { gaussdbRenderCheckExpressions } from './check-expressions';
import { gaussdbQualifyColumnType } from './codecs';
import { gaussdbTargetDescriptorMetaRuntime } from './descriptor-meta-runtime';
import { gaussdbCreateNamespace } from './gaussdb-schema';
import { gaussdbIndexTypes } from './index-types';
import { DEFAULT_NAMESPACE_ID } from './namespace-ids';

const gaussdbTargetDescriptorMetaBase = {
  ...gaussdbTargetDescriptorMetaRuntime,
  defaultNamespaceId: DEFAULT_NAMESPACE_ID,
  supportsNamespaces: true,
  indexTypes: gaussdbIndexTypes,
  authoring: {
    type: gaussdbAuthoringTypes,
    field: gaussdbAuthoringFieldPresets,
    entityTypes: gaussdbAuthoringEntityTypes,
    pslBlockDescriptors: gaussdbAuthoringPslBlockDescriptors,
    modelAttributes: gaussdbAuthoringModelAttributes,
    createNamespace: gaussdbCreateNamespace,
    qualifyColumnType: gaussdbQualifyColumnType,
    renderCheckExpressions: gaussdbRenderCheckExpressions,
    lowerEntityHandles: gaussdbLowerEntityHandles,
  },
} as const;

export const gaussdbTargetDescriptorMeta: typeof gaussdbTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = gaussdbTargetDescriptorMetaBase;

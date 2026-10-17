import type { EntityCoordinate } from '@internal/framework-components/ir';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { GaussDbNativeEnumSchemaNode } from './gaussdb-native-enum-schema-node';
import { GaussDbTableSchemaNode } from './gaussdb-table-schema-node';
import { gaussdbNodeEntityKind } from './schema-node-kinds';

/**
 * The storage-`entries` coordinate `(entityKind, entityName)` a GaussDB diff
 * node addresses — a table by its name, a native enum by its physical type
 * name. `undefined` for a node that is not a whole storage entity (a namespace,
 * a column, a policy). Lets ownership/subject resolution treat every entity kind
 * uniformly, the node self-describing its storage identity.
 */
export function gaussdbNodeStorageCoordinate(
  node: SqlSchemaIRNode,
): Pick<EntityCoordinate, 'entityKind' | 'entityName'> | undefined {
  if (GaussDbTableSchemaNode.is(node)) {
    const entityKind = gaussdbNodeEntityKind(node.nodeKind);
    return entityKind === undefined ? undefined : { entityKind, entityName: node.name };
  }
  if (GaussDbNativeEnumSchemaNode.is(node)) {
    const entityKind = gaussdbNodeEntityKind(node.nodeKind);
    return entityKind === undefined ? undefined : { entityKind, entityName: node.typeName };
  }
  return undefined;
}

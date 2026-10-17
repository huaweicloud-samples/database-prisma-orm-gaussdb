import { type } from 'arktype';

export const GaussDbRoleSchema = type({
  kind: "'role'",
  name: 'string',
  namespaceId: 'string',
  'control?': "'external'",
});

export const GaussDbRlsPolicySchema = type({
  kind: "'policy'",
  name: 'string',
  'prefix?': 'string',
  tableName: 'string',
  namespaceId: 'string',
  operation: "'select' | 'insert' | 'update' | 'delete' | 'all'",
  roles: type.string.array().readonly(),
  'using?': 'string',
  'withCheck?': 'string',
  permissive: 'boolean',
});

export const GaussDbRlsEnablementSchema = type({
  kind: "'rls'",
  tableName: 'string',
  namespaceId: 'string',
});

export const GaussDbNativeEnumSchema = type({
  kind: "'gaussdb-enum'",
  typeName: 'string',
  members: type.string.array().readonly(),
  'control?': "'managed' | 'tolerated' | 'external' | 'observed'",
});

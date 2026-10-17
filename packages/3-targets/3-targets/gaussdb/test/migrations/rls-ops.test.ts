import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { GaussDbRlsPolicy } from '../../src/core/gaussdb-rls-policy';
import {
  CreateGaussDbRlsPolicyCall,
  DropGaussDbRlsPolicyCall,
  EnableRowLevelSecurityCall,
} from '../../src/core/migrations/op-factory-call';
import {
  createRlsPolicy,
  dropRlsPolicy,
  enableRowLevelSecurity,
} from '../../src/core/migrations/operations/rls';
import { GaussDbCreatePolicy } from '../../src/exports/ddl';

function recordingCheckLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    lowerToExecuteRequest: async (ast) => {
      received.push(ast);
      return Object.freeze({
        sql: `LOWERED ${received.length}`,
        params: Object.freeze([`p${received.length}`]),
      });
    },
  };
  return { lowerer, received };
}

describe('renderCreatePolicySql role-name validation', () => {
  function policyWithRoles(roles: string[]): GaussDbRlsPolicy {
    return new GaussDbRlsPolicy({
      naming: parseNaming('p_ab12cd34', 'p'),
      tableName: 'profiles',
      namespaceId: 'public',
      operation: 'select',
      roles,
      using: '(true)',
      permissive: true,
      withCheck: undefined,
    });
  }

  it('renders TO PUBLIC when roles is empty', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await createRlsPolicy('public', 'profiles', policyWithRoles([]), lowerer);
    const ddlNode = received.find((n) => n instanceof GaussDbCreatePolicy) as GaussDbCreatePolicy;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.roles).toHaveLength(0);
  });

  it('renders a plain SQL identifier role without error', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await createRlsPolicy('public', 'profiles', policyWithRoles(['app_user']), lowerer);
    const ddlNode = received.find((n) => n instanceof GaussDbCreatePolicy) as GaussDbCreatePolicy;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.roles).toEqual(['app_user']);
  });

  it('renders multiple valid role names', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await createRlsPolicy(
      'public',
      'profiles',
      policyWithRoles(['app_user', 'read_only']),
      lowerer,
    );
    const ddlNode = received.find((n) => n instanceof GaussDbCreatePolicy) as GaussDbCreatePolicy;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.roles).toEqual(['app_user', 'read_only']);
  });

  it('rejects a role name containing a double-quote', async () => {
    const { lowerer } = recordingCheckLowerer();
    await expect(
      createRlsPolicy('public', 'profiles', policyWithRoles(['a"b']), lowerer),
    ).rejects.toThrow(/invalid role name/i);
  });

  it('rejects a role name containing a space', async () => {
    const { lowerer } = recordingCheckLowerer();
    await expect(
      createRlsPolicy('public', 'profiles', policyWithRoles(['my role']), lowerer),
    ).rejects.toThrow(/invalid role name/i);
  });

  it('rejects a role name containing a semicolon', async () => {
    const { lowerer } = recordingCheckLowerer();
    await expect(
      createRlsPolicy('public', 'profiles', policyWithRoles(['role;DROP TABLE']), lowerer),
    ).rejects.toThrow(/invalid role name/i);
  });
});

const basePolicy = new GaussDbRlsPolicy({
  naming: parseNaming('read_own_profiles_ab12cd34', 'read_own_profiles'),
  tableName: 'profiles',
  namespaceId: 'public',
  operation: 'select',
  roles: ['authenticated'],
  using: '(auth.uid() = user_id)',
  permissive: true,
  withCheck: undefined,
});

describe('createRlsPolicy op', () => {
  it('passes the correct GaussDbCreatePolicy node to the lowerer', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await createRlsPolicy('public', 'profiles', basePolicy, lowerer);
    const ddlNode = received.find((n) => n instanceof GaussDbCreatePolicy) as GaussDbCreatePolicy;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.name).toBe('read_own_profiles_ab12cd34');
    expect(ddlNode.schema).toBe('public');
    expect(ddlNode.table).toBe('profiles');
    expect(ddlNode.permissive).toBe(true);
    expect(ddlNode.operation).toBe('select');
    expect(ddlNode.roles).toEqual(['authenticated']);
    expect(ddlNode.using).toBe('(auth.uid() = user_id)');
    expect(ddlNode.withCheck).toBeUndefined();
  });

  it('passes withCheck when present', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const policy = new GaussDbRlsPolicy({
      naming: parseNaming('insert_own_profiles_ab12cd34', 'insert_own_profiles'),
      tableName: 'profiles',
      namespaceId: 'public',
      operation: 'insert',
      roles: ['authenticated'],
      withCheck: '(auth.uid() = user_id)',
      permissive: true,
      using: undefined,
    });
    await createRlsPolicy('public', 'profiles', policy, lowerer);
    const ddlNode = received.find((n) => n instanceof GaussDbCreatePolicy) as GaussDbCreatePolicy;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.withCheck).toBe('(auth.uid() = user_id)');
    expect(ddlNode.using).toBeUndefined();
  });

  it('passes permissive: false for RESTRICTIVE policies', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const policy = new GaussDbRlsPolicy({
      ...basePolicy,
      using: basePolicy.using,
      withCheck: basePolicy.withCheck,
      naming: parseNaming('restrict_profiles_ab12cd34', 'restrict_profiles'),
      permissive: false,
    });
    await createRlsPolicy('public', 'profiles', policy, lowerer);
    const ddlNode = received.find((n) => n instanceof GaussDbCreatePolicy) as GaussDbCreatePolicy;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.permissive).toBe(false);
  });

  // GaussDB exposes no pg_policies catalog (42P01, live-probed) — policy
  // existence is unobservable, so there are no catalog checks and idempotence
  // rides the leading `DROP POLICY IF EXISTS` (live-probed idempotent).
  it('carries no catalog checks and leads with DROP POLICY IF EXISTS', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await createRlsPolicy('public', 'profiles', basePolicy, lowerer);
    expect(received).toHaveLength(1);
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
    expect(op.execute).toEqual([
      {
        description: 'clear existing RLS policy "read_own_profiles_ab12cd34" if present',
        sql: 'DROP POLICY IF EXISTS "read_own_profiles_ab12cd34" ON "public"."profiles"',
      },
      {
        description: 'create RLS policy "read_own_profiles_ab12cd34"',
        sql: 'LOWERED 1',
        params: ['p1'],
      },
    ]);
  });

  it('operationClass is additive', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await createRlsPolicy('public', 'profiles', basePolicy, lowerer);
    expect(op.operationClass).toBe('additive');
  });
});

describe('enableRowLevelSecurity op', () => {
  it('emits the correct ALTER TABLE DDL with no unobservable catalog checks', async () => {
    const op = await enableRowLevelSecurity('public', 'profiles');
    expect(op.execute[0]?.sql).toBe(`ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY`);
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
  });

  it('operationClass is additive', async () => {
    const op = await enableRowLevelSecurity('public', 'profiles');
    expect(op.operationClass).toBe('additive');
  });
});

describe('dropRlsPolicy op', () => {
  it('drops via DROP POLICY IF EXISTS with no unobservable catalog checks', async () => {
    const op = await dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34');
    expect(op.execute).toEqual([
      {
        description: 'drop RLS policy "read_own_profiles_ab12cd34"',
        sql: 'DROP POLICY IF EXISTS "read_own_profiles_ab12cd34" ON "public"."profiles"',
      },
    ]);
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
  });

  it('operationClass is destructive', async () => {
    const op = await dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34');
    expect(op.operationClass).toBe('destructive');
  });
});

describe('CreateGaussDbRlsPolicyCall', () => {
  it('toOp() passes the same DDL node as createRlsPolicy()', async () => {
    const { lowerer: lowerer1, received: received1 } = recordingCheckLowerer();
    const { lowerer: lowerer2, received: received2 } = recordingCheckLowerer();
    const call = new CreateGaussDbRlsPolicyCall('public', 'profiles', basePolicy);
    await createRlsPolicy('public', 'profiles', basePolicy, lowerer1);
    await call.toOp(lowerer2);
    const ddlNode1 = received1.find((n) => n instanceof GaussDbCreatePolicy);
    const ddlNode2 = received2.find((n) => n instanceof GaussDbCreatePolicy);
    expect(ddlNode1).toEqual(ddlNode2);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreateGaussDbRlsPolicyCall('public', 'profiles', basePolicy);
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renderTypeScript() round-trips the call', () => {
    const call = new CreateGaussDbRlsPolicyCall('public', 'profiles', basePolicy);
    const rendered = call.renderTypeScript();
    expect(rendered).toContain('createRlsPolicy');
    expect(rendered).toContain('public');
    expect(rendered).toContain('profiles');
  });

  it('factoryName is createRlsPolicy', () => {
    const call = new CreateGaussDbRlsPolicyCall('public', 'profiles', basePolicy);
    expect(call.factoryName).toBe('createRlsPolicy');
  });

  it('operationClass is additive', () => {
    const call = new CreateGaussDbRlsPolicyCall('public', 'profiles', basePolicy);
    expect(call.operationClass).toBe('additive');
  });
});

describe('EnableRowLevelSecurityCall', () => {
  it('toOp() returns the correct DDL', async () => {
    const { lowerer } = recordingCheckLowerer();
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    const op = await call.toOp(lowerer);
    expect(op.execute[0]?.sql).toBe(`ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY`);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renderTypeScript() round-trips the call', () => {
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    const rendered = call.renderTypeScript();
    expect(rendered).toContain('enableRowLevelSecurity');
    expect(rendered).toContain('public');
    expect(rendered).toContain('profiles');
  });

  it('factoryName is enableRowLevelSecurity', () => {
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    expect(call.factoryName).toBe('enableRowLevelSecurity');
  });

  it('operationClass is additive', () => {
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    expect(call.operationClass).toBe('additive');
  });
});

describe('DropGaussDbRlsPolicyCall', () => {
  it('toOp() produces the same op shape as dropRlsPolicy()', async () => {
    const call = new DropGaussDbRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    const { lowerer } = recordingCheckLowerer();
    const fromCall = await call.toOp(lowerer);
    const fromFn = await dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34');
    expect(fromCall).toEqual(fromFn);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropGaussDbRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renderTypeScript() round-trips the call', () => {
    const call = new DropGaussDbRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    const rendered = call.renderTypeScript();
    expect(rendered).toContain('dropRlsPolicy');
    expect(rendered).toContain('public');
    expect(rendered).toContain('profiles');
    expect(rendered).toContain('read_own_profiles_ab12cd34');
  });

  it('factoryName is dropRlsPolicy', () => {
    const call = new DropGaussDbRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    expect(call.factoryName).toBe('dropRlsPolicy');
  });

  it('operationClass is destructive', () => {
    const call = new DropGaussDbRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    expect(call.operationClass).toBe('destructive');
  });
});

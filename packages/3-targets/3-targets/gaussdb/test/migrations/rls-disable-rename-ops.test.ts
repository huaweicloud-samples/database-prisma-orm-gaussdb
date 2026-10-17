import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { describe, expect, it } from 'vitest';
import {
  DisableRowLevelSecurityCall,
  RenameGaussDbRlsPolicyCall,
} from '../../src/core/migrations/op-factory-call';
import { disableRowLevelSecurity, renameRlsPolicy } from '../../src/core/migrations/operations/rls';
import { GaussDbAlterPolicyRename, GaussDbDisableRowLevelSecurity } from '../../src/exports/ddl';

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

const OLD_NAME = 'read_own_profiles_ab12cd34';
const NEW_NAME = 'owner_read_profiles_ab12cd34';

describe('disableRowLevelSecurity op', () => {
  // GaussDB has no `pg_class.relrowsecurity` column (42703, live-probed) —
  // enablement is unobservable, so the op carries no catalog checks.
  it('passes the correct GaussDbDisableRowLevelSecurity node to the lowerer', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await disableRowLevelSecurity('public', 'profiles', lowerer);
    expect(received).toHaveLength(1);
    const ddlNode = received.find(
      (n) => n instanceof GaussDbDisableRowLevelSecurity,
    ) as GaussDbDisableRowLevelSecurity;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.schema).toBe('public');
    expect(ddlNode.table).toBe('profiles');
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
  });

  it('operationClass is destructive — disabling RLS opens row access', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await disableRowLevelSecurity('public', 'profiles', lowerer);
    expect(op.operationClass).toBe('destructive');
  });

  it('op id and label name the table and the disable action', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await disableRowLevelSecurity('public', 'profiles', lowerer);
    expect(op.id).toBe('rowLevelSecurity.public.profiles.disable');
    expect(op.label).toBe('Disable row-level security on "profiles"');
  });
});

describe('renameRlsPolicy op', () => {
  // GaussDB exposes no pg_policies catalog (42P01, live-probed) — policy
  // existence is unobservable, so the op carries no catalog checks.
  it('passes the correct GaussDbAlterPolicyRename node to the lowerer', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await renameRlsPolicy('public', 'profiles', OLD_NAME, NEW_NAME, lowerer);
    expect(received).toHaveLength(1);
    const ddlNode = received.find(
      (n) => n instanceof GaussDbAlterPolicyRename,
    ) as GaussDbAlterPolicyRename;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.schema).toBe('public');
    expect(ddlNode.table).toBe('profiles');
    expect(ddlNode.name).toBe(OLD_NAME);
    expect(ddlNode.newName).toBe(NEW_NAME);
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
  });

  it('operationClass is widening — a rename never plans as a drop', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await renameRlsPolicy('public', 'profiles', OLD_NAME, NEW_NAME, lowerer);
    expect(op.operationClass).toBe('widening');
  });

  it('op id and label name both policy names', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await renameRlsPolicy('public', 'profiles', OLD_NAME, NEW_NAME, lowerer);
    expect(op.id).toBe(`rlsPolicy.public.profiles.${OLD_NAME}.rename`);
    expect(op.label).toBe(`Rename RLS policy "${OLD_NAME}" to "${NEW_NAME}" on "profiles"`);
  });
});

describe('DisableRowLevelSecurityCall', () => {
  it('toOp() passes the same DDL node as disableRowLevelSecurity()', async () => {
    const { lowerer: lowerer1, received: received1 } = recordingCheckLowerer();
    const { lowerer: lowerer2, received: received2 } = recordingCheckLowerer();
    const call = new DisableRowLevelSecurityCall('public', 'profiles');
    await disableRowLevelSecurity('public', 'profiles', lowerer1);
    await call.toOp(lowerer2);
    const ddlNode1 = received1.find((n) => n instanceof GaussDbDisableRowLevelSecurity);
    const ddlNode2 = received2.find((n) => n instanceof GaussDbDisableRowLevelSecurity);
    expect(ddlNode1).toEqual(ddlNode2);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DisableRowLevelSecurityCall('public', 'profiles');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renderTypeScript() round-trips the call', () => {
    const call = new DisableRowLevelSecurityCall('public', 'profiles');
    expect(call.renderTypeScript()).toBe(
      'this.disableRowLevelSecurity({ schema: "public", table: "profiles" })',
    );
  });

  it('factoryName is disableRowLevelSecurity', () => {
    const call = new DisableRowLevelSecurityCall('public', 'profiles');
    expect(call.factoryName).toBe('disableRowLevelSecurity');
  });

  it('operationClass is destructive', () => {
    const call = new DisableRowLevelSecurityCall('public', 'profiles');
    expect(call.operationClass).toBe('destructive');
  });
});

describe('RenameGaussDbRlsPolicyCall', () => {
  it('toOp() passes the same DDL node as renameRlsPolicy()', async () => {
    const { lowerer: lowerer1, received: received1 } = recordingCheckLowerer();
    const { lowerer: lowerer2, received: received2 } = recordingCheckLowerer();
    const call = new RenameGaussDbRlsPolicyCall('public', 'profiles', OLD_NAME, NEW_NAME);
    await renameRlsPolicy('public', 'profiles', OLD_NAME, NEW_NAME, lowerer1);
    await call.toOp(lowerer2);
    const ddlNode1 = received1.find((n) => n instanceof GaussDbAlterPolicyRename);
    const ddlNode2 = received2.find((n) => n instanceof GaussDbAlterPolicyRename);
    expect(ddlNode1).toEqual(ddlNode2);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new RenameGaussDbRlsPolicyCall('public', 'profiles', OLD_NAME, NEW_NAME);
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renderTypeScript() round-trips the call', () => {
    const call = new RenameGaussDbRlsPolicyCall('public', 'profiles', OLD_NAME, NEW_NAME);
    expect(call.renderTypeScript()).toBe(
      `this.renameRlsPolicy({ schema: "public", table: "profiles", from: "${OLD_NAME}", to: "${NEW_NAME}" })`,
    );
  });

  it('factoryName is renameRlsPolicy', () => {
    const call = new RenameGaussDbRlsPolicyCall('public', 'profiles', OLD_NAME, NEW_NAME);
    expect(call.factoryName).toBe('renameRlsPolicy');
  });

  it('operationClass is widening — plans without the destructive allowance', () => {
    const call = new RenameGaussDbRlsPolicyCall('public', 'profiles', OLD_NAME, NEW_NAME);
    expect(call.operationClass).toBe('widening');
  });
});

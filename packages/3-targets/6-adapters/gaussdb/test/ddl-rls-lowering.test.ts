import {
  GaussDbAlterPolicyRename,
  GaussDbCreatePolicy,
  GaussDbDisableRowLevelSecurity,
  GaussDbDropPolicy,
} from '@internal/target-gaussdb/ddl';
import { describe, expect, it } from 'vitest';
import { createGaussDbBuiltinCodecLookup } from '../src/core/codec-lookup';
import { GaussDbControlAdapter } from '../src/core/control-adapter';
import type { GaussDbContract } from '../src/core/types';

const adapter = new GaussDbControlAdapter(createGaussDbBuiltinCodecLookup());
const ctx = { contract: {} as GaussDbContract };

describe('GaussDbControlAdapter.lowerToExecuteRequest — RLS DDL', () => {
  it('renders CREATE POLICY with quoted identifiers and verbatim predicate', async () => {
    const ast = new GaussDbCreatePolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_read_ab12cd34',
      permissive: true,
      operation: 'select',
      roles: ['app_user'],
      using: '(auth.uid() = user_id)',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'CREATE POLICY "p_read_ab12cd34" ON "public"."profiles" AS PERMISSIVE FOR SELECT TO app_user USING ((auth.uid() = user_id))',
      params: [],
    });
  });

  // Live-probe dialect limits (probe/gaussdb_migration_ops_probe*.py): the
  // WITH CHECK clause is a 42601 syntax error in every FOR form, and FOR
  // INSERT/MERGE policies are rejected at the kernel level. Both surface as
  // explicit RUNTIME.POLICY_UNSUPPORTED errors — never a silent clause drop.
  it('rejects WITH CHECK with the GaussDB difference and alternatives', async () => {
    const ast = new GaussDbCreatePolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_upd_ab12cd34',
      permissive: true,
      operation: 'update',
      roles: ['app_user'],
      using: '(owner_id = 1)',
      withCheck: '(owner_id = 2)',
    });
    await expect(adapter.lowerToExecuteRequest(ast, ctx)).rejects.toMatchObject({
      code: 'RUNTIME.POLICY_UNSUPPORTED',
      meta: { policyName: 'p_upd_ab12cd34', clause: 'WITH CHECK' },
    });
  });

  it('rejects FOR INSERT policies as kernel-unsupported', async () => {
    const ast = new GaussDbCreatePolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_ins_ab12cd34',
      permissive: true,
      operation: 'insert',
      roles: ['app_user'],
      using: '(owner_id = 1)',
    });
    await expect(adapter.lowerToExecuteRequest(ast, ctx)).rejects.toMatchObject({
      code: 'RUNTIME.POLICY_UNSUPPORTED',
      meta: { policyName: 'p_ins_ab12cd34', operation: 'insert' },
    });
  });

  // FOR DELETE takes USING only.
  it('renders FOR DELETE with USING and no WITH CHECK', async () => {
    const ast = new GaussDbCreatePolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_del_ab12cd34',
      permissive: true,
      operation: 'delete',
      roles: ['app_user'],
      using: '(owner_id = 1)',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'CREATE POLICY "p_del_ab12cd34" ON "public"."profiles" AS PERMISSIVE FOR DELETE TO app_user USING ((owner_id = 1))',
      params: [],
    });
  });

  it('renders FOR ALL with USING only (no WITH CHECK on GaussDB)', async () => {
    const ast = new GaussDbCreatePolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_all_ab12cd34',
      permissive: true,
      operation: 'all',
      roles: ['app_user'],
      using: '(owner_id = 1)',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'CREATE POLICY "p_all_ab12cd34" ON "public"."profiles" AS PERMISSIVE FOR ALL TO app_user USING ((owner_id = 1))',
      params: [],
    });
  });

  // RESTRICTIVE + multiple roles render alongside USING.
  it('renders AS RESTRICTIVE with multiple roles', async () => {
    const ast = new GaussDbCreatePolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_del_restrict_ab12cd34',
      permissive: false,
      operation: 'delete',
      roles: ['app_user', 'admin'],
      using: '(owner_id = 1)',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'CREATE POLICY "p_del_restrict_ab12cd34" ON "public"."profiles" AS RESTRICTIVE FOR DELETE TO app_user, admin USING ((owner_id = 1))',
      params: [],
    });
  });

  it('renders DROP POLICY with quoted identifiers', async () => {
    const ast = new GaussDbDropPolicy({
      schema: 'public',
      table: 'profiles',
      name: 'p_read_ab12cd34',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'DROP POLICY "p_read_ab12cd34" ON "public"."profiles"',
      params: [],
    });
  });

  it('renders ALTER TABLE … DISABLE ROW LEVEL SECURITY', async () => {
    const ast = new GaussDbDisableRowLevelSecurity({ schema: 'public', table: 'profiles' });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'ALTER TABLE "public"."profiles" DISABLE ROW LEVEL SECURITY',
      params: [],
    });
  });

  it('renders ALTER POLICY … RENAME TO with all identifiers quoted', async () => {
    const ast = new GaussDbAlterPolicyRename({
      schema: 'public',
      table: 'profiles',
      name: 'read_own_profiles_ab12cd34',
      newName: 'owner_read_profiles_ab12cd34',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: 'ALTER POLICY "read_own_profiles_ab12cd34" ON "public"."profiles" RENAME TO "owner_read_profiles_ab12cd34"',
      params: [],
    });
  });
});

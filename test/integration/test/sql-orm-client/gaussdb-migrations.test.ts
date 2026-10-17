/**
 * Real-GaussDB migration journeys (S2-1): full-form contract → plan → apply →
 * introspect → verify in one pass, incremental re-planning, re-apply
 * idempotency (the IF NOT EXISTS semantics), explicit capability errors for
 * unsupported RLS forms, and behavioral RLS verification through a non-admin
 * second role.
 *
 * Dialect notes (probe/gaussdb_migration_ops_probe*.py, 2026-10-15): GaussDB
 * rejects `IF NOT EXISTS` (42601) — idempotency rides existence prechecks and
 * `DROP POLICY IF EXISTS`. The RLS engine works for non-sysadmin roles
 * (USING filtering, owner bypass, FORCE) but exposes no catalogs, so verify
 * grades RLS drift as warnings — the behavioral role check below is the hard
 * evidence. `WITH CHECK` and FOR INSERT policies are kernel-unsupported and
 * surface as explicit RUNTIME.POLICY_UNSUPPORTED errors at plan time.
 *
 * GaussDB RLS nuance (live-probed): an RLS-enabled table with no policy
 * applicable to the querying role does NOT default-deny the way stock
 * PostgreSQL does — the role simply sees all rows. The behavioral journey
 * therefore grants the reader the policy's role as membership.
 *
 * Isolated in a throwaway database (`prisma_8_migration_journeys_gaussdb`)
 * dropped and recreated on a maintenance connection; skips when `GAUSSDB_URL`
 * is not set.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildContractFromPsl,
  createGaussDbDriver,
  emptySchema,
  familyInstance,
  frameworkComponents,
  introspectSchema,
  MIGRATION_TEST_DB,
  migrationTestDatabaseUrl,
  planContract,
  timeouts,
} from '../_harness/gaussdb-migrations';

const MAINTENANCE_URL = process.env['GAUSSDB_URL'] ?? '';

function isRealGaussDbAvailable(): Promise<boolean> {
  if (MAINTENANCE_URL.length === 0) return Promise.resolve(false);
  return createGaussDbDriver(MAINTENANCE_URL)
    .then(async (driver) => {
      await driver.query('select 1');
      await driver.close();
      return true;
    })
    .catch(() => false);
}

const FULL_FORM_PSL = `// use prisma-8
namespace public {
  native_enum OrderStatus {
    draft  = "draft"
    active = "active"
    @@map("mj_order_status")
  }

  model mj_customers {
    id    Int    @id
    email String @unique
  }

  model mj_orders {
    id        Int          @id
    status    pg.enum(OrderStatus)
    title     VarChar(100)
    note      String?
    amount    Numeric(12, 2)
    big       BigInt
    small     SmallInt
    ratio     Float?
    flag      Boolean      @default(true)
    meta      Jsonb?
    payload   Bytes?
    createdAt DateTime     @default(now())
    ownerId   Int          @map("owner_id")
    owner     mj_customers @relation(fields: [ownerId], references: [id])
    amountNum Number(10, 2)?
    labelV2   VarChar2(20)?
    nameNv    NVarChar2(20)?
    body      Clob?
    attachment Blob?
    token     Raw(16)?

    @@map("mj_orders")
    @@check(expression: "amount >= 0", name: "mj_orders_amount_nonneg")
    @@index([status])
    @@index([title, note])
  }

  model mj_audited {
    id    Int    @id
    label String

    @@map("mj_audited")
    @@rls
  }

  policy_select mj_audited_read {
    target = mj_audited
    roles  = [authenticated]
    using  = "id > 100"
  }
}
`;

const GROWN_PSL = FULL_FORM_PSL.replace(
  '    token     Raw(16)?\n',
  '    token     Raw(16)?\n    priority  Int?\n',
).replace('    @@index([title, note])\n', '    @@index([title, note])\n    @@index([priority])\n');

const WITH_CHECK_PSL = `// use prisma-8
namespace public {
  model mj_guarded {
    id    Int    @id
    label String

    @@map("mj_guarded")
    @@rls
  }

  policy_update mj_guarded_write {
    target    = mj_guarded
    roles     = [authenticated]
    using     = "true"
    withCheck = "true"
  }
}
`;

const INSERT_PSL = `// use prisma-8
namespace public {
  model mj_guarded {
    id    Int    @id
    label String

    @@map("mj_guarded")
    @@rls
  }

  policy_insert mj_guarded_insert {
    target = mj_guarded
    roles  = [authenticated]
  }
}
`;

describe.runIf(await isRealGaussDbAvailable())(
  'gaussdb migration journeys — plan/apply/verify on a real server',
  () => {
    const driverRef: { current: Awaited<ReturnType<typeof createGaussDbDriver>> | null } = {
      current: null,
    };

    async function testDriver() {
      driverRef.current ??= await createGaussDbDriver(migrationTestDatabaseUrl());
      return driverRef.current;
    }

    beforeAll(async () => {
      const maintenance = await createGaussDbDriver(MAINTENANCE_URL);
      await maintenance.query(`DROP DATABASE IF EXISTS ${MIGRATION_TEST_DB}`);
      await maintenance.query(`CREATE DATABASE ${MIGRATION_TEST_DB}`);
      await maintenance.close();
      // The full-form contract's RLS policy grants to `authenticated` — the
      // role must exist for CREATE POLICY (42704 otherwise).
      const driver = await testDriver();
      await driver.query('DROP ROLE IF EXISTS authenticated');
      await driver.query("CREATE ROLE authenticated NOLOGIN PASSWORD 'MjAuth@123'");
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      if (driverRef.current) {
        await driverRef.current.close();
        driverRef.current = null;
      }
      const maintenance = await createGaussDbDriver(MAINTENANCE_URL);
      await maintenance.query(`DROP DATABASE IF EXISTS ${MIGRATION_TEST_DB}`);
      await maintenance.query('DROP ROLE IF EXISTS authenticated');
      await maintenance.close();
    }, timeouts.spinUpPpgDev);

    it(
      'full-form contract plans, applies, and verifies in one pass',
      async () => {
        const driver = await testDriver();
        const contract = buildContractFromPsl(FULL_FORM_PSL);
        const plan = await planContract(contract, emptySchema);
        await applyPlanHarnessed(driver, plan, contract);

        const introspected = await introspectSchema(driver);
        const verify = familyInstance.verifySchema({
          contract,
          schema: introspected,
          strict: true,
          frameworkComponents,
        });
        expect(verify.ok).toBe(true);
        // The live server hides the RLS catalogs, so the declared policy is
        // graded as an unobservable warning rather than a diff failure —
        // assert the warning actually surfaced instead of silently vanishing.
        const rlsWarnings = verify.schema.warnings?.issues.filter((issue) =>
          issue.path.some((segment) => segment.includes('mj_audited')),
        );
        expect(rlsWarnings?.length ?? 0).toBeGreaterThan(0);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'incremental contract re-plans, applies, and verifies (add column + index)',
      async () => {
        const driver = await testDriver();
        const introspectedBefore = await introspectSchema(driver);
        const grown = buildContractFromPsl(GROWN_PSL);

        const plan = await planContract(grown, introspectedBefore);
        const ids = await Promise.all(plan.operations).then((ops) => ops.map((op) => op.id));
        expect(ids.some((id) => id.includes('priority'))).toBe(true);
        await applyPlanHarnessed(driver, plan, grown);

        const introspectedAfter = await introspectSchema(driver);
        const verify = familyInstance.verifySchema({
          contract: grown,
          schema: introspectedAfter,
          strict: true,
          frameworkComponents,
        });
        expect(verify.ok).toBe(true);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      're-applying the same contract is idempotent (IF NOT EXISTS semantics)',
      async () => {
        const driver = await testDriver();
        // A fresh plan from the empty schema against a database that already
        // holds the grown objects: every op's postcheck pre-satisfies, so
        // the runner skips each one instead of erroring on the existing
        // objects — the existence-precheck equivalent of IF NOT EXISTS.
        const contract = buildContractFromPsl(GROWN_PSL);
        const plan = await planContract(contract, emptySchema);
        await applyPlanHarnessed(driver, plan, contract);

        const introspected = await introspectSchema(driver);
        const verify = familyInstance.verifySchema({
          contract,
          schema: introspected,
          strict: true,
          frameworkComponents,
        });
        expect(verify.ok).toBe(true);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'RLS filters rows for a non-admin second role (behavioral verification)',
      async () => {
        const driver = await testDriver();
        // Seed rows through the table owner connection (appuser — sysadmin,
        // so it bypasses RLS and sees everything).
        await driver.query(
          'INSERT INTO "public"."mj_audited" (id, label) VALUES (1, $1), (2, $2)',
          ['secret-a', 'secret-b'],
        );

        const roleName = 'mj_rls_reader';
        // Runtime-random: the role exists only inside this journey, and a
        // throwaway credential should never be committed even for a
        // create-and-drop test role. Kept within GaussDB's default
        // `password_max_length` of 32 (probe survey §5.2).
        const rolePassword = `Mj-${randomUUID().replaceAll('-', '').slice(0, 20)}Aa1!`;
        await driver.query(`DROP ROLE IF EXISTS ${roleName}`);
        try {
          await driver.query(`CREATE ROLE ${roleName} LOGIN PASSWORD '${rolePassword}'`);
          await driver.query(`GRANT USAGE ON SCHEMA "public" TO ${roleName}`);
          await driver.query(`GRANT SELECT ON "public"."mj_audited" TO ${roleName}`);
          // The policy grants TO authenticated — membership brings the reader
          // under it (see the module note on the no-applicable-policy nuance).
          await driver.query(`GRANT authenticated TO ${roleName}`);
          const readerUrl = new URL(MAINTENANCE_URL);
          readerUrl.username = roleName;
          readerUrl.password = rolePassword;
          readerUrl.pathname = `/${MIGRATION_TEST_DB}`;
          const reader = await createGaussDbDriver(readerUrl.toString());
          try {
            const visible = await reader.query<{ count: string }>(
              'SELECT count(*)::text AS count FROM "public"."mj_audited"',
            );
            // policy USING (id > 100) filters both seeded rows away for the
            // non-admin role, while the owner connection sees them.
            expect(visible.rows[0]?.count).toBe('0');
            const ownerVisible = await driver.query<{ count: string }>(
              'SELECT count(*)::text AS count FROM "public"."mj_audited"',
            );
            expect(ownerVisible.rows[0]?.count).toBe('2');
          } finally {
            await reader.close();
          }
        } finally {
          // Cleanup must tolerate the role never having been created (an
          // earlier failure in the try block) — REVOKE on a missing role
          // raises 42704 and would mask the real error.
          const roleExists = await driver.query(
            `SELECT 1 FROM pg_roles WHERE rolname = '${roleName}'`,
          );
          if (roleExists.rows.length > 0) {
            await driver.query(`REVOKE authenticated FROM ${roleName}`);
            await driver.query(`REVOKE ALL ON SCHEMA "public" FROM ${roleName}`);
            await driver.query(`REVOKE ALL ON "public"."mj_audited" FROM ${roleName}`);
            await driver.query(`DROP ROLE ${roleName}`);
          }
        }
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'WITH CHECK and FOR INSERT policies fail planning with explicit capability errors',
      async () => {
        // Plan operations build lazily — awaiting the operation promises is
        // where the op builder lowers the policy DDL and the capability
        // error surfaces.
        const withCheckPlan = await planContract(buildContractFromPsl(WITH_CHECK_PSL), emptySchema);
        await expect(Promise.all(withCheckPlan.operations)).rejects.toMatchObject({
          code: 'RUNTIME.POLICY_UNSUPPORTED',
          meta: { clause: 'WITH CHECK' },
        });

        const insertPlan = await planContract(buildContractFromPsl(INSERT_PSL), emptySchema);
        await expect(Promise.all(insertPlan.operations)).rejects.toMatchObject({
          code: 'RUNTIME.POLICY_UNSUPPORTED',
          meta: { operation: 'insert' },
        });
      },
      timeouts.spinUpPpgDev,
    );
  },
);

async function applyPlanHarnessed(
  driver: Awaited<ReturnType<typeof createGaussDbDriver>>,
  plan: Awaited<ReturnType<typeof planContract>>,
  contract: ReturnType<typeof buildContractFromPsl>,
): Promise<void> {
  const { applyPlan } = await import('../_harness/gaussdb-migrations');
  await applyPlan(driver, plan, contract);
}

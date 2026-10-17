/**
 * A unique index and a redundant plain index on the identical
 * column tuple are two distinct name-identified siblings. Both introspect,
 * and a contract declaring both verifies clean — the pre-name-identity
 * introspection dedup ("keep only the unique one per column tuple") is gone.
 */
import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { gaussdbCreateNamespace } from '@internal/target-gaussdb/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type GaussDbControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

function buildPairContract(): Contract<SqlStorage> {
  return {
    target: 'gaussdb',
    targetFamily: 'sql',
    profileHash: profileHash('index-twins'),
    storage: new SqlStorage({
      storageHash: coreHash('index-twins'),
      namespaces: {
        public: gaussdbCreateNamespace({
          id: asNamespaceId('public'),
          entries: {
            table: {
              pair: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false },
                  email: { nativeType: 'text', codecId: 'gaussdb/text@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [
                  { name: 'pair_email_unique_idx', columns: ['email'], unique: true },
                  { name: 'pair_email_plain_idx', columns: ['email'], unique: false },
                ],
                foreignKeys: [],
              },
            },
          },
        }),
      },
    }),
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

describe('same-tuple twin indexes coexist and verify', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: GaussDbControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('a contract declaring both twins verifies clean against the live pair', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE pair (id int PRIMARY KEY, email text NOT NULL)');
    await driver!.query('CREATE UNIQUE INDEX pair_email_unique_idx ON pair (email)');
    await driver!.query('CREATE INDEX pair_email_plain_idx ON pair (email)');

    const contract = buildPairContract();
    const introspected = await familyInstance.introspect({ driver: driver!, contract });
    const verifyResult = familyInstance.verifySchema({
      contract,
      schema: introspected,
      strict: true,
      frameworkComponents,
    });

    if (!verifyResult.ok) {
      throw new Error(
        `verifySchema failed: ${JSON.stringify(verifyResult.schema.issues, null, 2)}`,
      );
    }
    expect(verifyResult.schema.issues).toEqual([]);
  });

  it('dropping the plain twin out-of-band fails verify with a missing index', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE TABLE pair (id int PRIMARY KEY, email text NOT NULL)');
    await driver!.query('CREATE UNIQUE INDEX pair_email_unique_idx ON pair (email)');

    const contract = buildPairContract();
    const introspected = await familyInstance.introspect({ driver: driver!, contract });
    const verifyResult = familyInstance.verifySchema({
      contract,
      schema: introspected,
      strict: false,
      frameworkComponents,
    });

    expect(verifyResult.ok).toBe(false);
    expect(JSON.stringify(verifyResult.schema.issues)).toContain('pair_email_plain_idx');
  });
});

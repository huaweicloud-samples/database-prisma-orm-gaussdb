import gaussdbAdapter from '@internal/adapter-gaussdb/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import sql from '@internal/family-sql/control';
import gaussdb from '@internal/target-gaussdb/control';
import { ok } from '@internal/utils/result';
import { defineConfig } from '@prisma/cli-engine';
import { contract } from './contract';

// Emits the package-local test fixture consumed by the raw-lane and
// prepare-declaration tests, through the real emit pipeline — never
// hand-edited. Run via this package's `emit` script.
export default defineConfig({
  orm: ormConfig({
    family: sql,
    target: gaussdb,
    adapter: gaussdbAdapter,
    contract: {
      source: {
        load: async () => ok(contract),
      },
      output: '../generated/contract.json',
    },
  }),
});

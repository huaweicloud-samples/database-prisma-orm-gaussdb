import gaussdbAdapter from '@internal/adapter-gaussdb/control';
import type { PrismaNextConfig } from '@internal/config/config-types';
import { defineConfig as coreDefineConfig } from '@internal/config/config-types';
import gaussdbDriver from '@internal/driver-gaussdb/control';
import sql from '@internal/family-sql/control';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { typescriptContractFromPath } from '@internal/sql-contract-ts/config-types';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@internal/target-gaussdb/codec-ids';
import gaussdb from '@internal/target-gaussdb/control';
import gaussdbPackRef from '@internal/target-gaussdb/pack';
import { gaussdbCreateNamespace } from '@internal/target-gaussdb/types';
import { ifDefined } from '@internal/utils/defined';
import { extname, join } from 'pathe';

export interface GaussDbConfigOptions {
  readonly contract: string;
  readonly output?: string;
  readonly db?: {
    readonly connection?: string;
  };
  readonly extensions?: readonly ControlExtensionDescriptor<'sql', 'gaussdb'>[];
  readonly migrations?: {
    readonly dir?: string;
  };
}

function deriveOutputPath(contractPath: string): string {
  const ext = extname(contractPath);
  if (ext.length === 0) {
    return `${contractPath}.json`;
  }
  return `${contractPath.slice(0, -ext.length)}.json`;
}

export function defineConfig(options: GaussDbConfigOptions): PrismaNextConfig<'sql', 'gaussdb'> {
  const extensions = options.extensions ?? [];
  const output =
    options.output !== undefined
      ? join(options.output, 'contract.json')
      : deriveOutputPath(options.contract);
  const ext = extname(options.contract);

  const contractConfig =
    ext === '.ts'
      ? typescriptContractFromPath(options.contract, output)
      : prismaContract(options.contract, {
          output,
          target: gaussdbPackRef,
          createNamespace: gaussdbCreateNamespace,
          enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
        });

  return coreDefineConfig({
    family: sql,
    target: gaussdb,
    adapter: gaussdbAdapter,
    driver: gaussdbDriver,
    extensions,
    contract: contractConfig,
    ...ifDefined('db', options.db),
    ...ifDefined('migrations', options.migrations),
  });
}

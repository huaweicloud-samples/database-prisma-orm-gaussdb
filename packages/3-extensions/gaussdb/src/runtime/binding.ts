import { InternalError } from '@internal/utils/internal-error';
import type { Client, Pool } from 'pg';
import { gaussdbError } from '../errors';

export const isPgPool = (pg: Pool | Client): pg is Pool =>
  'totalCount' in pg && 'idleCount' in pg && 'waitingCount' in pg;

export const isPgClient = (pg: Pool | Client): pg is Client =>
  'escapeIdentifier' in pg && 'escapeLiteral' in pg;

export type GaussDbBinding =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'pgPool'; readonly pool: Pool }
  | { readonly kind: 'pgClient'; readonly client: Client };

export type GaussDbBindingInput =
  | {
      readonly binding: GaussDbBinding;
      readonly url?: never;
      readonly pg?: never;
    }
  | {
      readonly url: string;
      readonly binding?: never;
      readonly pg?: never;
    }
  | {
      readonly pg: Pool | Client;
      readonly binding?: never;
      readonly url?: never;
    };

type GaussDbBindingFields = {
  readonly binding?: GaussDbBinding;
  readonly url?: string;
  readonly pg?: Pool | Client;
};

export function validateGaussDbUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw gaussdbError('RUNTIME.BINDING_INVALID', 'GaussDB URL must be a non-empty string', {
      meta: { extension: 'gaussdb', reason: 'empty url' },
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw gaussdbError('RUNTIME.BINDING_INVALID', 'GaussDB URL must be a valid URL', {
      meta: { extension: 'gaussdb', reason: 'unparseable url' },
    });
  }

  if (
    parsed.protocol !== 'gaussdb:' &&
    parsed.protocol !== 'postgres:' &&
    parsed.protocol !== 'postgresql:'
  ) {
    throw gaussdbError(
      'RUNTIME.BINDING_INVALID',
      'GaussDB URL must use gaussdb://, postgres:// or postgresql://',
      { meta: { extension: 'gaussdb', reason: 'wrong scheme', received: parsed.protocol } },
    );
  }

  if (parsed.protocol === 'gaussdb:') {
    parsed.protocol = 'postgresql:';
    return parsed.toString();
  }

  return trimmed;
}

export function resolveGaussDbBinding(options: GaussDbBindingInput): GaussDbBinding {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.pg !== undefined);

  if (providedCount !== 1) {
    throw gaussdbError(
      'RUNTIME.BINDING_INVALID',
      'Provide one binding input: binding, url, or pg',
      {
        fix: 'Pass exactly one of `binding`, `url`, or `pg`.',
        meta: { extension: 'gaussdb', reason: 'zero or multiple binding inputs' },
      },
    );
  }

  if (options.binding !== undefined) {
    return options.binding;
  }

  if (options.url !== undefined) {
    return { kind: 'url', url: validateGaussDbUrl(options.url) };
  }

  const pgBinding = options.pg;
  if (pgBinding === undefined) {
    throw new InternalError('Invariant violation: expected pg binding after validation');
  }

  if (isPgPool(pgBinding)) {
    return { kind: 'pgPool', pool: pgBinding };
  }

  if (isPgClient(pgBinding)) {
    return { kind: 'pgClient', client: pgBinding };
  }

  throw gaussdbError(
    'RUNTIME.BINDING_INVALID',
    'Unable to determine pg binding type from pg input; use binding with explicit kind',
    {
      fix: 'Pass `binding: { kind: "pgPool", pool }` or `binding: { kind: "pgClient", client }` instead of `pg`.',
      meta: { extension: 'gaussdb', reason: 'unrecognizable pg object' },
    },
  );
}

export function resolveOptionalGaussDbBinding(
  options: GaussDbBindingFields,
): GaussDbBinding | undefined {
  const providedCount =
    Number(options.binding !== undefined) +
    Number(options.url !== undefined) +
    Number(options.pg !== undefined);

  if (providedCount === 0) {
    return undefined;
  }

  return resolveGaussDbBinding(options as GaussDbBindingInput);
}

import type {
  RuntimeDriverDescriptor,
  RuntimeDriverInstance,
} from '@internal/framework-components/execution';
import type {
  SqlConnection,
  SqlDriver,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlStatementStats,
} from '@internal/sql-relational-core/ast';
import { gaussDbDriverDescriptorMeta } from '../core/descriptor-meta';
import { driverError } from '../driver-error';
import {
  createBoundDriverFromBinding,
  type GaussDbBinding,
  type GaussDbDriverCreateOptions,
} from '../gaussdb-driver';

export type GaussDbRuntimeDriver = RuntimeDriverInstance<'sql', 'gaussdb'> &
  SqlDriver<GaussDbBinding>;

const USE_BEFORE_CONNECT_MESSAGE =
  'GaussDB driver not connected. Call connect(binding) before acquireConnection or execute.';
const ALREADY_CONNECTED_MESSAGE =
  'GaussDB driver already connected. Call close() before reconnecting with a new binding.';

function unboundQuery<Row>(): AsyncIterable<Row> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          throw driverError('DRIVER.NOT_CONNECTED', USE_BEFORE_CONNECT_MESSAGE);
        },
      };
    },
  };
}

class GaussDbUnboundDriverImpl implements GaussDbRuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'gaussdb' as const;

  #delegate: SqlDriver<GaussDbBinding> | null = null;
  #closed = false;
  #cursorOpts: GaussDbDriverCreateOptions['cursor'];
  #preparedStatements: GaussDbDriverCreateOptions['preparedStatements'];

  constructor(options?: GaussDbDriverCreateOptions) {
    this.#cursorOpts = options?.cursor;
    this.#preparedStatements = options?.preparedStatements;
  }

  get state(): 'unbound' | 'connected' | 'closed' {
    if (this.#delegate !== null) {
      return 'connected';
    }
    if (this.#closed) {
      return 'closed';
    }
    return 'unbound';
  }

  #requireDelegate(): SqlDriver<GaussDbBinding> {
    const delegate = this.#delegate;
    if (delegate === null) {
      throw driverError('DRIVER.NOT_CONNECTED', USE_BEFORE_CONNECT_MESSAGE);
    }
    return delegate;
  }

  async connect(binding: GaussDbBinding): Promise<void> {
    if (this.#delegate !== null) {
      throw driverError('DRIVER.ALREADY_CONNECTED', ALREADY_CONNECTED_MESSAGE, {
        bindingKind: binding.kind,
      });
    }
    this.#delegate = createBoundDriverFromBinding(binding, this.#cursorOpts, {
      preparedStatements: this.#preparedStatements,
    });
    this.#closed = false;
  }

  async acquireConnection(): Promise<SqlConnection> {
    const delegate = this.#requireDelegate();
    const connection = await delegate.acquireConnection();
    return this.#wrapConnection(connection, delegate);
  }

  /**
   * Wraps an acquired connection so that teardown paths which close the
   * underlying delegate (notably `destroy()` on a pgClient binding, where
   * the single socket means a destroyed connection invalidates the driver)
   * also reset our own `#delegate` reference. Without this, a failed
   * transaction rollback would leave the outer unbound wrapper reporting
   * `connected` while routing subsequent work to an already-ended delegate.
   */
  #wrapConnection(connection: SqlConnection, delegate: SqlDriver<GaussDbBinding>): SqlConnection {
    const syncDelegateState = (): void => {
      if (this.#delegate === delegate && delegate.state === 'closed') {
        this.#delegate = null;
        this.#closed = true;
      }
    };
    const wrapped: SqlConnection = {
      beginTransaction: connection.beginTransaction.bind(connection),
      query: connection.query.bind(connection),
      execute: connection.execute.bind(connection),
      release: async () => {
        try {
          await connection.release();
        } finally {
          syncDelegateState();
        }
      },
      destroy: async (reason?: unknown) => {
        try {
          await connection.destroy(reason);
        } finally {
          syncDelegateState();
        }
      },
    };
    if (connection.explain) {
      wrapped.explain = connection.explain.bind(connection);
    }
    return wrapped;
  }

  async close(): Promise<void> {
    const delegate = this.#delegate;
    if (delegate !== null) {
      this.#delegate = null;
      await delegate.close();
    }
    this.#closed = true;
  }

  query<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const delegate = this.#delegate;
    return delegate === null ? unboundQuery<Row>() : delegate.query<Row>(request);
  }

  async execute(request: SqlExecuteRequest): Promise<SqlStatementStats> {
    const delegate = this.#delegate;
    if (delegate === null) {
      throw driverError('DRIVER.NOT_CONNECTED', USE_BEFORE_CONNECT_MESSAGE);
    }
    return delegate.execute(request);
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    const delegate = this.#requireDelegate();
    const explain = delegate.explain;
    if (explain === undefined) {
      throw driverError('DRIVER.NOT_CONNECTED', USE_BEFORE_CONNECT_MESSAGE);
    }
    return explain.call(delegate, request);
  }
}

const gaussDbRuntimeDriverDescriptor: RuntimeDriverDescriptor<
  'sql',
  'gaussdb',
  GaussDbDriverCreateOptions,
  GaussDbRuntimeDriver
> = {
  ...gaussDbDriverDescriptorMeta,
  create(options?: GaussDbDriverCreateOptions): GaussDbRuntimeDriver {
    return new GaussDbUnboundDriverImpl(options);
  },
};

export default gaussDbRuntimeDriverDescriptor;
export { suppressIdleConnectionErrors } from '@internal/utils/suppress-idle-connection-errors';
export type {
  GaussDbBinding,
  GaussDbDriverCreateOptions,
  QueryResult,
} from '../gaussdb-driver';

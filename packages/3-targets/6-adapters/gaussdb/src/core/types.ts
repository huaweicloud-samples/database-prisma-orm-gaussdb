import type { CodecRegistry } from '@internal/framework-components/codec';
import type { StorageColumn, StorageTable } from '@internal/sql-contract/types';
import type {
  AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  Direction,
  InsertAst,
  JoinAst,
  LiteralExpr,
  LoweredStatement,
  OperationExpr,
  ParamRef,
  SelectAst,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import type {
  AnyGaussDbCodecDescriptor,
  GaussDbCodecDescriptorRegistry,
} from '@internal/target-gaussdb/codec-descriptor';

export type GaussDbCodecRegistry = CodecRegistry & GaussDbCodecDescriptorRegistry;

export interface GaussDbAdapterOptions {
  readonly profileId?: string;
  /**
   * Custom GaussDB codec descriptors contributed alongside the built-ins.
   * The complete descriptor set is validated at construction and becomes the
   * single source for both codec materialization and target-specific lowering.
   */
  readonly codecDescriptors?: readonly AnyGaussDbCodecDescriptor[];
}

export type { GaussDbContract } from '@internal/target-gaussdb/types';

export type Expr = ColumnRef | ParamRef | DefaultValueExpr;

export interface OrderClause {
  readonly expr: ColumnRef;
  readonly dir: Direction;
}

export type GaussDbLoweredStatement = LoweredStatement;

export type {
  AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  Direction,
  InsertAst,
  JoinAst,
  LiteralExpr,
  OperationExpr,
  ParamRef,
  SelectAst,
  StorageColumn,
  StorageTable,
  UpdateAst,
};

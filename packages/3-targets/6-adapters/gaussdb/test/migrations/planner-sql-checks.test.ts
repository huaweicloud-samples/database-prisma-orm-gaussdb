import {
  buildExpectedFormatType,
  qualifyTableName,
} from '@internal/target-gaussdb/planner-sql-checks';
import { describe, expect, it } from 'vitest';

// Raw-string check helpers (columnExistsCheck, columnNullabilityCheck,
// columnTypeCheck, columnDefaultExistsCheck, columnHasNoDefaultCheck,
// tableHasPrimaryKeyCheck, tableIsEmptyCheck, toRegclassLiteral) were replaced
// by typed AST builders (columnExistsAst, columnNullabilityAst, etc.) from
// @internal/target-gaussdb/contract-free. Construction pins live in
// target-gaussdb test/migrations/verification-checks.test.ts and lowering
// pins in test/verification-checks-lowering.test.ts.

describe('qualifyTableName', () => {
  it('quotes schema and table', () => {
    expect(qualifyTableName('public', 'user')).toBe('"public"."user"');
  });
});

describe('buildExpectedFormatType', () => {
  const noHooks = new Map();

  describe('FORMAT_TYPE_DISPLAY mappings', () => {
    it('maps int2 to smallint', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'int2', codecId: 'gaussdb/int2@1', nullable: false },
          noHooks,
        ),
      ).toBe('smallint');
    });

    it('maps int4 to integer', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false },
          noHooks,
        ),
      ).toBe('integer');
    });

    it('maps int8 to bigint', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'int8', codecId: 'gaussdb/int8@1', nullable: false },
          noHooks,
        ),
      ).toBe('bigint');
    });

    it('maps float4 to real', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'float4', codecId: 'gaussdb/float4@1', nullable: false },
          noHooks,
        ),
      ).toBe('real');
    });

    it('maps float8 to double precision', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'float8', codecId: 'gaussdb/float8@1', nullable: false },
          noHooks,
        ),
      ).toBe('double precision');
    });

    it('maps bool to boolean', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'bool', codecId: 'gaussdb/bool@1', nullable: false },
          noHooks,
        ),
      ).toBe('boolean');
    });
  });

  describe('unmapped native types pass through', () => {
    it('returns nativeType as-is for text', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'text', codecId: 'gaussdb/text@1', nullable: false },
          noHooks,
        ),
      ).toBe('text');
    });

    it('returns nativeType as-is for uuid', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'uuid', codecId: 'gaussdb/uuid@1', nullable: false },
          noHooks,
        ),
      ).toBe('uuid');
    });
  });

  describe('user-defined types (typeRef path)', () => {
    it('returns simple lowercase UDT name unquoted', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'my_status', codecId: 'app/udt@1', nullable: false, typeRef: 'MyStatus' },
          noHooks,
        ),
      ).toBe('my_status');
    });

    it('quotes reserved word used as UDT name', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'user', codecId: 'app/udt@1', nullable: false, typeRef: 'User' },
          noHooks,
        ),
      ).toBe('"user"');
    });

    it('quotes another reserved word (select)', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: 'select', codecId: 'app/udt@1', nullable: false, typeRef: 'Select' },
          noHooks,
        ),
      ).toBe('"select"');
    });

    it('quotes mixed-case identifier', () => {
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'OrderStatus',
            codecId: 'app/udt@1',
            nullable: false,
            typeRef: 'OrderStatus',
          },
          noHooks,
        ),
      ).toBe('"OrderStatus"');
    });

    it('quotes identifier with hyphens', () => {
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'order-status',
            codecId: 'app/udt@1',
            nullable: false,
            typeRef: 'OrderStatus',
          },
          noHooks,
        ),
      ).toBe('"order-status"');
    });

    it('quotes identifier with spaces', () => {
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'order status',
            codecId: 'app/udt@1',
            nullable: false,
            typeRef: 'OrderStatus',
          },
          noHooks,
        ),
      ).toBe('"order status"');
    });

    it('quotes identifier starting with digit', () => {
      expect(
        buildExpectedFormatType(
          { nativeType: '2fa_type', codecId: 'app/udt@1', nullable: false, typeRef: 'TwoFaType' },
          noHooks,
        ),
      ).toBe('"2fa_type"');
    });
  });

  describe('codec hook expansion', () => {
    it('delegates to expandNativeType when typeParams and codec hook exist', () => {
      const hooks = new Map([
        [
          'gaussdb/decimal@1',
          {
            expandNativeType: ({
              nativeType,
              typeParams,
            }: {
              nativeType: string;
              typeParams?: Record<string, unknown>;
            }) => `${nativeType}(${typeParams?.['precision']},${typeParams?.['scale']})`,
          },
        ],
      ]);
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'numeric',
            codecId: 'gaussdb/decimal@1',
            nullable: false,
            typeParams: { precision: 10, scale: 2 },
          },
          hooks,
        ),
      ).toBe('numeric(10,2)');
    });

    it('falls back to display map when typeParams present but no hook', () => {
      expect(
        buildExpectedFormatType(
          {
            nativeType: 'int4',
            codecId: 'gaussdb/int4@1',
            nullable: false,
            typeParams: { someParam: true },
          },
          noHooks,
        ),
      ).toBe('integer');
    });
  });
});

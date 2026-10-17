import { describe, expect, it } from 'vitest';
import { gaussdbRenderCheckExpressions } from '../src/core/check-expressions';
import { gaussdbTargetDescriptorMeta } from '../src/core/descriptor-meta';
import gaussdbTargetPack from '../src/exports/pack';

describe('gaussdbTargetDescriptorMeta', () => {
  it('declares namespace support, so emitted model names keep their namespace segment', () => {
    expect(gaussdbTargetDescriptorMeta.supportsNamespaces).toBe(true);
  });

  it('declares the expected defaultNamespaceId', () => {
    expect(gaussdbTargetDescriptorMeta.defaultNamespaceId).toBe('public');
  });

  // Check emission is hook-conditional and a target without the hook writes no
  // checks — a supported branch, so losing this wiring would silently stop
  // GaussDB emitting every check rather than failing anywhere.
  it('contributes the check-expression renderer', () => {
    expect(gaussdbTargetDescriptorMeta.authoring.renderCheckExpressions).toBe(
      gaussdbRenderCheckExpressions,
    );
  });
});

describe('gaussdbTargetPack', () => {
  it('matches the descriptor metadata', () => {
    expect(gaussdbTargetPack).toEqual(gaussdbTargetDescriptorMeta);
  });
});

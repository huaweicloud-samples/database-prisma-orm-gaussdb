/**
 * Own entry point (rather than folded into `exports/planner.ts`) because
 * cross-package tests need `buildGaussDbPlanDiff` as a public import to
 * drive the one-differ path directly — they cannot reach it via a relative
 * `src` import.
 */
export { buildGaussDbPlanDiff } from '../core/migrations/diff-database-schema';

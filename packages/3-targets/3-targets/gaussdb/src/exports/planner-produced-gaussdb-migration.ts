/**
 * Entry name intentionally asymmetric with the postgres target pack's
 * `planner-produced-postgres-migration`: that name is frozen by the published
 * surface (9-public shells), while this pack has no consumers yet and takes
 * the semantically correct name.
 */
export { TypeScriptRenderableGaussDbMigration } from '../core/migrations/planner-produced-gaussdb-migration';

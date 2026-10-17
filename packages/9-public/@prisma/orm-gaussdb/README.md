# @prisma/orm-gaussdb

The one package a GaussDB application installs. It wires the framework, the SQL family, and the GaussDB target into a single lazy client, and brings the rest of the stack along as exact-pinned dependencies:

```jsonc
// package.json
{ "dependencies": { "@prisma/orm-gaussdb": "0.16.0" } }
```

```
@prisma/orm-gaussdb
├── @prisma/orm-framework       contracts, components, runtime core
├── @prisma/orm-family-sql      SQL contract, lanes, ORM client, runtime
├── @prisma/orm-target-gaussdb  target descriptor + adapter + pg driver
└── @prisma/orm-toolchain       ORM command family for the `prisma` CLI, emitter, config loader
```

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/runtime` | `gaussdb(...)` — the lazy query client |
| `/serverless` | the serverless runtime variant |
| `/static` | statically composed runtime for pre-wired deployments |
| `/config` | `defineConfig` for `prisma.config.ts` |
| `/contract-builder` | `defineContract`, GaussDB native types (含 A 兼容模式 Oracle 类型), RLS authoring |
| `/target`, `/family` | the GaussDB target pack and the SQL family pack |
| `/migration`, `/control` | migration planning and the control client |

Generated contract files import their types from the facade, so an application never has to depend on a package it did not install:

| Namespace | Forwards |
| --- | --- |
| `/contract`, `/contract/*` | `@prisma/orm-framework/contract` |
| `/components`, `/components/*` | `@prisma/orm-framework/components` |
| `/family-contract`, `/family-contract/*` | `@prisma/orm-family-sql/contract` |
| `/target/*` | `@prisma/orm-target-gaussdb/target` |
| `/adapter`, `/adapter/*` | `@prisma/orm-target-gaussdb/adapter` |

These forward; they do not copy. `@prisma/orm-gaussdb/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so shared registries and `instanceof` checks hold across the boundary.

## GaussDB 已知差异

GaussDB 与 PostgreSQL 的方言差异（`ON CONFLICT` 不可用、无 `LATERAL`、jsonb 函数子集、RLS 边界、`server_version` 上报 9.2.4 兼容假象——版本探测不依赖版本号等）以 `@internal/gaussdb`（源码仓 `packages/3-extensions/gaussdb/README.md`）"已知差异"一节为权威清单。

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Verification note

本壳的 tsdown build 依赖 rolldown，在 Windows 本机因已知路径/external 正则问题必败（见仓库 todo.md"已知环境问题"）。壳的 build 与 tarball 级验证（`test/` 下的 facade 测试需要先 build 出 dist）在 Linux CI 上执行；Windows 本机仅做 manifest 校验测试、typecheck 与 lint。

## Decomposing

An application that outgrows the default wiring installs the four platform packages directly and recomposes them — for example replacing `@prisma/orm-target-gaussdb/adapter` with a pooled adapter of its own while keeping the target and driver. Because everything is pinned to one lockstep version, the decomposed install reproduces exactly what the facade would have provided, minus the replaced part.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.

# @prisma/orm-target-gaussdb

The concrete GaussDB target of Prisma 8: the target descriptor (DDL planning, codecs, migration rendering), the GaussDB adapter, and the `pg`-based driver.

Applications receive it as an exact-pinned dependency of `@prisma/orm-gaussdb`; app developers install that facade. Extension authors targeting GaussDB and decomposed installs (for example, replacing the adapter with a custom one while keeping the target and driver) import this package directly.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/target` | target descriptor: DDL planner, codecs, migration rendering, control |
| `/adapter` | GaussDB adapter: column types, operation types, runtime wiring |
| `/driver` | `pg`-based driver: control and runtime |

A bare namespace import (e.g. `@prisma/orm-target-gaussdb/adapter`) aggregates that layer's full surface; deeper paths select individual modules.

## GaussDB 已知差异

GaussDB 与 PostgreSQL 存在方言差异（`ON CONFLICT`、`LATERAL`、jsonb 函数子集、RLS 目录缺失、`server_version` 上报 9.2.4 兼容假象等），完整清单见 `@internal/gaussdb`（源码仓 `packages/3-extensions/gaussdb/README.md`）的"已知差异"一节；发布壳不改写这些行为，只承载对应模块。

## Verification note

本壳的 tsdown build 依赖 rolldown，在 Windows 本机因已知路径/external 正则问题必败（见仓库 todo.md"已知环境问题"）。壳的 build 与 tarball 级验证（`test/` 下的 cross-shell 测试需要先 build 出 dist）在 Linux CI 上执行；Windows 本机仅做 manifest 校验测试、typecheck 与 lint。

## Responsibilities

Everything GaussDB-specific: native type normalization (含 A 兼容模式 Oracle 类型), DDL generation, schema diffing, RLS canonicalization, and the wire connection. Shared SQL semantics live in `@prisma/orm-family-sql`.

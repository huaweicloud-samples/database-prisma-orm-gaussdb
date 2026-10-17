# database-prisma-orm-gaussdb

华为 **GaussDB**（507 集中式 / Oracle 兼容模式）的 [Prisma ORM 8](./README-upstream.md) 独立 provider，基于 Prisma ORM **8.0.0-rc.11** 完整源码交付。

## 概述

本项目在 Prisma ORM 8 monorepo 中以平行包形态新增 GaussDB provider，与 postgres provider **能力面对等**：运行时 CRUD/事务/upsert、全形态迁移（DDL）、内省推断、npm 发布壳、CLI 脚手架、Oracle 兼容类型。全部能力经本地 GaussDB 507.0.0 实例的 **22 条端到端 journey + 约 2740 条包级单测**验证，交付分支每个提交均通过独立规格审查与质量审查。

## 能力矩阵

| 能力 | 状态 | 真库证据 |
|---|---|---|
| 运行时（CRUD / 事务 / upsert / returning） | ✅ | 9 journeys |
| 迁移（全形态 DDL + 增量 + 幂等） | ✅ | 5 journeys |
| 内省（schema 反向生成，round-trip 可执行性已证明） | ✅ | 2 journeys |
| Oracle 兼容类型（number / varchar2 / nvarchar2 / clob / blob / raw） | ✅ | round-trip journeys |
| RLS | ✅（引擎生效；verify warn 语义 + 行为级验证） | 行为 journey |
| 发布壳（`@prisma/orm-gaussdb`）+ CLI init | ✅ | manifest 校验 69 全绿 |
| LATERAL / hash 索引 / WITH CHECK / 原生 date | ❌ 显式报错或引导 | 能力门/差异文档 |

## 快速开始

```ts
import { gaussdb } from '@prisma/orm-gaussdb';
import contractJson from './gaussdb/contract.json';
import type { Contract } from './gaussdb/contract';

const db = gaussdb<Contract>({
  contractJson,
  url: 'gaussdb://appuser:<密码>@localhost:5432/your_db',
});

// 查询 / 迁移 / 内省的完整流程见 delivery-docs/2026-10-17-业务接入指南.md
```

脚手架：`orm init --target gaussdb`

## 仓库结构

```
packages/3-targets/3-targets/gaussdb    DDL / codec / 契约序列化
packages/3-targets/6-adapters/gaussdb   DML 渲染 / 能力声明
packages/3-targets/7-drivers/gaussdb    node-pg wire 层
packages/3-extensions/gaussdb           gaussdb() 用户入口
packages/9-public/@prisma/orm-*         发布壳（facade + platform）
test/integration/                       真库 E2E journeys（GAUSSDB_URL 门控）
delivery-docs/                          交付文档（总结 / 测试 / 接入指南）
```

## 文档

- [交付总结报告](./delivery-docs/2026-10-17-交付总结报告.md) — 决策记录、三期交付全景、质量保障体系
- [测试文档](./delivery-docs/2026-10-17-测试文档.md) — 测试分层、命令、22 条 journey 清单、基线对照
- [业务接入指南](./delivery-docs/2026-10-17-业务接入指南.md) — 安装 / 连接 / 迁移 / 内省 / Oracle 类型操作手册
- [已知差异与边界](./packages/3-extensions/gaussdb/README.md) — 用户视角完整清单（13+ 条，含来源标注）

## 测试

```powershell
pnpm install
pnpm build --continue          # Windows 预存 10 个壳包失败为已知项，Linux CI 正常
$env:GAUSSDB_URL = 'postgresql://appuser:<密码>@localhost:5432/your_db'
pnpm exec vitest run test/sql-orm-client/gaussdb.test.ts          # 运行时 9
pnpm exec vitest run test/sql-orm-client/gaussdb-migrations.test.ts   # 迁移 5
pnpm exec vitest run test/sql-orm-client/gaussdb-infer.test.ts        # 内省 2
```

不设置 `GAUSSDB_URL` 时真库 journey 全部自动 skip（CI 无 GaussDB 不影响流水线）。

## 已知差异与边界（摘要）

- 空字符串写入 text 列回读为 `null`（A 模式 Oracle 语义）
- `server_version` 上报 9.2.4 假象，勿用版本号做能力判断
- 云上生产实例默认 sha256 认证（华为私有机制）——本地/自建容器不受影响
- RLS 策略信息不出现在内省产物（目录缺席）
- Windows 本地构建存在预存环境项（壳包 build 等）——Linux CI 正常

完整清单见「已知差异与边界」链接。

---

## 关于 Prisma ORM

本仓库基于官方 [Prisma ORM](https://github.com/prisma/orm) 8.0.0-rc.11 源码构建，除上述 GaussDB provider 外未修改任何原有能力。官方 README 见 [README-upstream.md](./README-upstream.md)，上游文档与发布信息请访问 [prisma/orm](https://github.com/prisma/orm)。

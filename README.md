# 有迹（YouTrace）

面向 Windows 的本地优先个人执行与努力记录应用，把目标、计划、行动、真实投入、成果证据和复盘调整连接成一条可追溯闭环。

## 功能亮点

- **完整执行闭环：** 从领域、项目、目标和任务，一直记录到努力、成果与复盘。
- **本地工作区：** SQLite 数据库、附件、备份和导出全部保存在用户选择的目录中。
- **计划与日历：** 支持年、季度、月、周、日计划，以及时间块、容量和倒计时风险。
- **真实努力账本：** 支持计时、补录、困难、实际结果、下一步和不可覆盖的更正历史。
- **学习与实践：** 管理习惯、指标、课程、教材、知识点、错题、测试和复习队列。
- **跨模块整理：** 通过备忘、标签、全文搜索、组合筛选和保存视图连接不同对象。
- **数据安全：** 提供工作区锁、异常草稿与计时恢复、分层备份、数据库损坏恢复、迁移、回收站和可读导出。
- **桌面体验：** 提供浅色/深色主题、可调字号、自绘窗口、托盘后台和本地提醒。

## 下载

Windows 10/11 x64 用户可直接下载：

- [有迹 v1.0.6 安装版](https://github.com/xwbperson/YouTrace/releases/download/v1.0.6/YouTrace-1.0.6-Setup.exe)
- [有迹 v1.0.6 便携版](https://github.com/xwbperson/YouTrace/releases/download/v1.0.6/YouTrace-1.0.6-Portable.exe)

安装包目前没有 Authenticode 数字签名，Windows SmartScreen 可能显示“未知发布者”。

| 文件 | SHA-256 |
|---|---|
| `YouTrace-1.0.6-Setup.exe` | `01E4C0D4AA0F33CB7E341C396A6862F471A7BD103F66033F8A592C064BFFF335` |
| `YouTrace-1.0.6-Portable.exe` | `C7B01D80878EB04FAABF9FC63A12F5F49C69C57AC5A6D439031711245AE444BE` |

## 快速开始

1. 启动安装版或便携版。
2. 选择“创建工作区”，并指定一个可长期保存、定期备份的本地目录。
3. 创建项目与下一步任务，或先在“备忘”中记录突然想到的事情。
4. 在“今日”开始计时，在“记录”和“复盘”中检查真实投入与结果。
5. 在“更多”中创建第一个备份，并把备份复制到另一块磁盘。

业务数据默认离线保存，不需要账户，也不会上传到远程服务器。

如果不清楚什么时候使用计划、日历、记录、备忘和复盘，请从
[使用教程：从计划到复盘](docs/10-使用教程-从计划到复盘.md) 开始。

## 本地开发

要求 Windows 10/11 x64、Node.js 22 和 npm 10。

```powershell
git clone https://github.com/xwbperson/YouTrace.git
Set-Location YouTrace
npm install
npm run dev
```

## 常用命令

```powershell
npm run typecheck
npm test
npm run test:performance
npm run test:docs
npm run build
npm run test:electron
npm run dist:win
```

`npm run dist:win` 在 `release/` 中生成 NSIS 安装版、便携版和解包目录。Electron 测试包含真实主进程、preload、SQLite、安装、卸载和发布包启动流程。

## 技术栈

- Electron 43、React 19、TypeScript 7、Vite 7
- better-sqlite3、TanStack Query、Zustand、Radix UI
- Vitest、Playwright Electron、electron-builder

## 项目文档

- [项目文档索引](docs/00-文档索引.md)
- [产品需求文档](docs/01-产品需求文档-PRD.md)
- [技术架构](docs/04-技术架构.md)
- [工作区与数据安全](docs/05-工作区与数据安全.md)
- [v1 验收标准](docs/06-v1验收标准.md)
- [v1 实现与验收报告](docs/07-v1实现与验收报告.md)
- [v1 发布说明](docs/08-v1发布说明.md)
- [v1 人工验收清单](docs/09-v1人工验收清单.md)
- [使用教程：从计划到复盘](docs/10-使用教程-从计划到复盘.md)

## 当前状态

代码、55 项单元/集成测试、25 项 Electron 流程和本机 Windows 发布包已经验证。整体版本仍保持
`PREPARED`：干净 Windows、真实移动盘、混合 DPI 多显示器、Windows Narrator、系统通知和
最终用户体验仍需按 [人工验收清单](docs/09-v1人工验收清单.md) 确认。

## 许可

`UNLICENSED`。当前仓库未授予复制、分发或商业使用许可。

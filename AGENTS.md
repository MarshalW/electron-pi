# Electron Pi - Electron + PI SDK 桌面聊天

## 概述

Electron 桌面应用，集成 `@earendil-works/pi-coding-agent` SDK，提供 AI 对话界面。

## 架构

```
Renderer (index.html)
    ↕ contextBridge (preload.js)
Main Process (main.js)
    ↕ @earendil-works/pi-coding-agent
AgentSession (Tool calling, LLM 通信)
```

## 关键文件

| 文件 | 说明 |
|---|---|
| `src/main.js` | 主进程：窗口管理、PI SDK、IPC 通道 |
| `src/preload.js` | contextBridge 暴露 `window.pi.*` API |
| `src/index.html` | 渲染层：设置表单 + 聊天界面 |
| `config.json` | 开发配置（gitignore，需从 example 复制） |
| `config.example.json` | 配置模板 |
| `electron-builder.yml` | 构建配置（identity: null 跳过签名） |

## IPC 通道

| Channel | 方向 | 说明 |
|---|---|---|
| `config:get` | Renderer → Main | 读取配置 |
| `config:save` | Renderer → Main | 保存配置 |
| `session:create` | Renderer → Main | 创建 AgentSession |
| `session:send` | Renderer → Main | 发送 prompt |
| `session:abort` | Renderer → Main | 中止当前回复 |
| `pi:event` | Main → Renderer | 推送流式事件 |

## 配置

- **开发**：项目根目录 `config.json`
- **生产**：`~/.electron-proto/config.json`（首次运行自动创建模板）

```json
{
  "provider": "deepseek",
  "model": "deepseek-v4-flash",
  "apiKey": "sk-xxx",
  "cwd": "/path/to/workspace"
}
```

## PI SDK 集成要点

- 模型 `deepseek-v4-flash` 是 SDK 内置模型，无需额外注册
- Auth 通过 `AuthStorage.setRuntimeApiKey()` 注入，同时设置 `DEEPSEEK_API_KEY` 环境变量
- Session 使用 `SessionManager.inMemory()`（无持久化）
- 事件通过 `session.subscribe()` 监听，经 IPC 推送到渲染进程
- PI SDK 为 ESM-only，在 main.js 中用 `await import()` 动态加载

## 命令

```bash
npm start          # 开发启动
npm run build:mac  # 构建 macOS DMG
```

## 首次运行

1. 复制 `config.example.json` 为 `config.json`
2. 填入 API Key 和工作目录
3. `npm start` 启动
4. 或通过 UI 设置表单填写

## 注意事项

- 无 Apple Developer 签名，构建的 .dmg 仅限本机使用
- `config.json` 已 gitignore，勿提交 API Key
- 需 Node.js 20+

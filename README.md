# coauthor

M0：Billboard 基础闭环（无 LLM 也能跑）。

## 快速试跑（M0 闭环）

```bash
# 1) 创建 task（会输出 taskId）
npm run dev -- task create "demo"

# 2) 提交 patch proposal（从 stdin 读 unified diff）
npm run dev -- patch propose <taskId> demo/doc.tex < demo/patches/doc-hello-to-HELLO.diff

# 3) 应用 patch（会真的修改 demo/doc.tex）
npm run dev -- patch accept <taskId> latest

# 4) 回放事件流（确认发生过什么）
npm run dev -- log replay <taskId>
```

也可以启动 TUI（交互界面）：

```bash
npm run dev
```

在 TUI 中输入 `/help` 查看命令；`/log replay [taskId]` 会把事件打印到终端并在界面提示回放条数。

## 开发

```bash
npm i
npm run dev
```

## 构建与测试

```bash
npm run build
npm test
```

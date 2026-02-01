# Demo

这个目录提供一个最小的 `.tex` + unified diff，方便验证 M0 的 patch/apply/replay 闭环。

## 跑通闭环（CLI）

在仓库根目录执行：

```bash
# 1) 创建任务（输出 taskId）
npm run dev -- task create "demo"

# 2) 提交 patch proposal（从 stdin 读 unified diff）
npm run dev -- patch propose <taskId> demo/doc.tex < demo/patches/doc-hello-to-HELLO.diff

# 3) 应用 patch（会真的修改 demo/doc.tex）
npm run dev -- patch accept <taskId> latest

# 4) 回放事件流
npm run dev -- log replay <taskId>
```

## 在 TUI 里回放（打印到终端）

```bash
npm run dev
```

进入 TUI 后输入：

- `/log replay`：回放全部事件
- `/log replay <taskId>`：只回放某个任务的事件

事件会打印到终端，界面里会提示回放条数。


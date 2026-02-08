# Security Policy

## Filesystem Access & Boundaries

CoAuthor enforces strict boundaries for filesystem access to ensure security and portability.

### The ArtifactStore Abstraction
All file access MUST go through the `ArtifactStore` port (`src/domain/ports/artifactStore.ts`). Direct usage of `node:fs` or `node:fs/promises` in application logic or tools is **prohibited**.

This abstraction ensures:
1.  **Sandboxing**: Access is restricted to the workspace root (`baseDir`).
2.  **Portability**: The backing store can be swapped (e.g., in-memory for tests, remote S3 for cloud, etc.).
3.  **Validation**: Path traversal attacks (e.g. `../../etc/passwd`) are blocked by the adapter.

### FsArtifactStore Implementation
The default `FsArtifactStore` (`src/infra/fsArtifactStore.ts`) implements strict path validation:
- All paths are resolved relative to `baseDir`.
- Any resolved path that falls outside `baseDir` triggers an `Access denied` error.
- This applies to all operations: `readFile`, `writeFile`, `listDir`, `exists`, `mkdir`, `stat`.

### Development Guidelines
- **Do not import `fs`**: Use `ctx.artifactStore` in Tools or inject `ArtifactStore` into Services.
- **Relative Paths**: Always use relative paths when interacting with `ArtifactStore`.
- **Review**: Any PR introducing `node:fs` imports outside of `src/infra/` adapters should be rejected.

/**
 * Seed Server — combines HTTP (Hono) + WebSocket on a single port.
 *
 * Usage:
 *   const server = new SeedServer(app, { authToken })
 *   await server.start()        // binds to localhost:PORT
 *   console.log(server.address) // { host, port }
 *   await server.stop()         // graceful shutdown
 *
 * Design:
 * - Single process (required for JsonlEventStore AsyncMutex).
 * - localhost-only by default (security: no external network access).
 * - Static file serving for the Web UI SPA (web/dist/).
 */

import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { serveStatic } from '@hono/node-server/serve-static'
import { createHttpApp, type HttpAppDeps } from './http/httpServer.js'
import { SeedWsServer, type WsServerDeps } from './ws/wsServer.js'
import type { App } from '../../interfaces/app/createApp.js'

// ============================================================================
// Types
// ============================================================================

/** Default port for the Seed dev server. Matches Vite proxy in web/vite.config.ts. */
export const DEFAULT_PORT = 3120

export interface ServerOptions {
  port?: number
  host?: string
  authToken: string
}

// ============================================================================
// Server
// ============================================================================

export class SeedServer {
  readonly #app: App
  readonly #opts: Required<ServerOptions>
  #httpServer: Server | undefined
  #wsServer: SeedWsServer | undefined
  #actualPort: number | undefined

  constructor(app: App, opts: ServerOptions) {
    this.#app = app
    this.#opts = {
      port: opts.port ?? DEFAULT_PORT,
      host: opts.host ?? '127.0.0.1',
      authToken: opts.authToken,
    }
  }

  async start(): Promise<void> {
    // Build Hono app
    const httpDeps: HttpAppDeps = {
      taskService: this.#app.taskService,
      interactionService: this.#app.interactionService,
      eventService: this.#app.eventService,
      auditService: this.#app.auditService,
      runtimeManager: this.#app.runtimeManager,
      artifactStore: this.#app.artifactStore,
      conversationStore: this.#app.conversationStore,
      authToken: this.#opts.authToken,
      baseDir: this.#app.baseDir,
    }
    const honoApp = createHttpApp(httpDeps)

    // Serve static Web UI if built
    const webDistDir = join(this.#app.baseDir, 'node_modules', '.seed-web')
    const localWebDist = join(process.cwd(), 'web', 'dist')
    const staticRoot = existsSync(localWebDist) ? localWebDist : existsSync(webDistDir) ? webDistDir : undefined

    if (staticRoot) {
      honoApp.use('/*', serveStatic({ root: staticRoot }))
      // SPA fallback: serve index.html for any non-API, non-static route
      // Cache index.html content after first read
      let cachedIndexHtml: string | undefined
      honoApp.get('*', async (c) => {
        if (c.req.path.startsWith('/api/') || c.req.path === '/api' || c.req.path === '/ws') {
          return c.notFound()
        }
        const indexPath = join(staticRoot, 'index.html')
        if (!cachedIndexHtml) {
          if (!existsSync(indexPath)) return c.notFound()
          cachedIndexHtml = await readFile(indexPath, 'utf-8')
        }
        return c.html(cachedIndexHtml)
      })
    }

    // Manual http.Server + Hono fetch (needed for WS upgrade support)
    this.#httpServer = createServer(async (req, res) => {
      const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`
      const headers = new Headers()
      for (const [key, val] of Object.entries(req.headers)) {
        if (val) headers.set(key, Array.isArray(val) ? val.join(', ') : val)
      }
      // Forward the actual remote address so Hono middleware can check it
      // (the Request object doesn't carry socket info).
      if (req.socket.remoteAddress) {
        headers.set('x-remote-address', req.socket.remoteAddress)
      }

      let body: Buffer | undefined
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const MAX_BODY_SIZE = 10 * 1024 * 1024 // 10 MB (B15)
        const chunks: Buffer[] = []
        let totalBytes = 0
        for await (const chunk of req) {
          totalBytes += (chunk as Buffer).length
          if (totalBytes > MAX_BODY_SIZE) {
            res.writeHead(413, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Request body too large' }))
            return
          }
          chunks.push(chunk as Buffer)
        }
        body = Buffer.concat(chunks)
      }

      const request = new Request(url, { method: req.method, headers, body })
      const response = await honoApp.fetch(request)

      res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
      if (response.body) {
        const reader = response.body.getReader()
        try {
          const pump = async (): Promise<void> => {
            const { done, value } = await reader.read()
            if (done) { res.end(); return }
            res.write(value)
            return pump()
          }
          await pump()
        } catch (err) {
          console.error('[server] Response stream pump error:', err)
          reader.cancel().catch(() => {})
          if (!res.writableEnded) res.end()
        }
      } else {
        const text = await response.text()
        res.end(text)
      }
    })

    // Attach WebSocket server
    const wsDeps: WsServerDeps = {
      events$: this.#app.store.events$,
      uiEvents$: this.#app.uiBus.events$,
      getEventsAfter: (id) => this.#app.eventService.getEventsAfter(id),
      authToken: this.#opts.authToken,
    }
    this.#wsServer = new SeedWsServer(wsDeps)
    this.#wsServer.attach(this.#httpServer)

    // Listen
    await new Promise<void>((resolve) => {
      this.#httpServer!.listen(this.#opts.port, this.#opts.host, () => {
        const addr = this.#httpServer!.address()
        if (addr && typeof addr === 'object') {
          this.#actualPort = addr.port
        }
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    this.#wsServer?.close()
    await new Promise<void>((resolve, reject) => {
      if (this.#httpServer) {
        this.#httpServer.close((err) => (err ? reject(err) : resolve()))
      } else {
        resolve()
      }
    })
    this.#httpServer = undefined
    this.#wsServer = undefined
    this.#actualPort = undefined
  }

  get address(): { host: string; port: number } | undefined {
    if (!this.#actualPort) return undefined
    return { host: this.#opts.host, port: this.#actualPort }
  }

  get isRunning(): boolean {
    return this.#httpServer?.listening ?? false
  }
}

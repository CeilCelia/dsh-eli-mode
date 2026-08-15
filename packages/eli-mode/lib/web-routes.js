// 知识库页面 + 立绘静态服务 + JSON API + 设置桥接（host 平面）
import { promises as fsp } from 'node:fs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'

export const name = 'eli-web-routes'
export const inject = ['webServer']

const KB_ROOT = () => process.env.ELI_KB_ROOT || path.join(os.homedir(), '.dsh', 'eli-knowledge')
const UI_DIR = () => path.join(KB_ROOT(), 'ui')

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => { try { resolve(data.length > 0 ? JSON.parse(data) : {}) } catch { reject(new Error('invalid JSON body')) } })
    req.on('error', reject)
  })
}
function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

/** 读取 dsh 界面语言偏好（~/.dsh/settings.yaml 的 locale.preference），供 wiki 页面默认语言。 */
function dshLocale() {
  try {
    const text = readFileSync(path.join(os.homedir(), '.dsh', 'settings.yaml'), 'utf8')
    const m = /locale:\s*\r?\n\s+preference:\s*['"]?([a-zA-Z-]+)/.exec(text)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}
function file(res, fp, type) {
  try {
    const buf = readFileSync(fp)
    // no-store：立绘可被配置页即时替换，禁止浏览器缓存旧图
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store' })
    res.end(buf)
  } catch { res.writeHead(404); res.end() }
}

export function apply(ctx) {
  const server = ctx.webServer
  ctx.effect(() => server.register({ kind: 'exact', path: '/eli-kb', handler: (_r, res) => {
    try {
      let html = readFileSync(path.join(UI_DIR(), 'index.html'), 'utf8')
      const lang = dshLocale()
      if (lang === 'zh' || lang === 'en') {
        html = html.replace('</head>', "<script>window.__KB_LANG__='" + lang + "';</script></head>")
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html)
    } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('eli-kb UI not found') }
  } }), 'eli-web.route-ui()')
  ctx.effect(() => server.register({ kind: 'exact', path: '/eli-kb/art/left', handler: (_r, res) => file(res, path.join(UI_DIR(), 'art-left.webp'), 'image/webp') }), 'eli-web.route-art-left()')
  ctx.effect(() => server.register({ kind: 'exact', path: '/eli-kb/art/right', handler: (_r, res) => file(res, path.join(UI_DIR(), 'art-right.webp'), 'image/webp') }), 'eli-web.route-art-right()')
  ctx.effect(() => server.register({ kind: 'prefix', path: '/eli-kb/api', handler: async (req, res) => {
    const kb = ctx.get('eliKb')
    if (kb === undefined) return json(res, 503, { ok: false, error: 'eliKb 服务不可用' })
    try {
      const method = (new URL(req.url ?? '/', 'http://x').pathname.split('/').pop() || '')
      const args = await readBody(req)
      if (method === 'tree') return json(res, 200, { ok: true, tree: await kb.tree() })
      if (method === 'read') {
        const entry = await kb.read(args.id)
        if (entry === null) return json(res, 200, { ok: false, error: 'not found: ' + args.id })
        return json(res, 200, { ok: true, entry: { id: entry.id, title: entry.title, content: entry.content, links: entry.links || [], backlinks: entry.backlinks || [] } })
      }
      if (method === 'write') return json(res, 200, { ok: true, id: await kb.write(args.id, args.title, args.content) })
      if (method === 'remove') return json(res, 200, { ok: true, removed: await kb.remove(args.id) })
      if (method === 'search') { const hits = await kb.search(args.query); return json(res, 200, { ok: true, hits: hits.map((h) => ({ id: h.id, title: h.title, excerpt: h.excerpt })) }) }
      if (method === 'balance') return json(res, 200, await kb.getBalance())
      return json(res, 200, { ok: false, error: 'unknown method: ' + method })
    } catch (error) { return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }) }
  } }), 'eli-web.route-api()')
  // 立绘上传：POST { side: 'left'|'right', data: <base64> } → 写入 ~/.dsh/eli-knowledge/ui/art-<side>.webp
  ctx.effect(() => server.register({ kind: 'exact', path: '/eli-kb/api/art', handler: async (req, res) => {
    try {
      const args = await readBody(req)
      const side = args.side === 'right' ? 'right' : 'left'
      const data = typeof args.data === 'string' ? args.data : ''
      if (data.length === 0) return json(res, 400, { ok: false, error: 'empty art data' })
      const buf = Buffer.from(data, 'base64')
      if (buf.length === 0) return json(res, 400, { ok: false, error: 'invalid base64' })
      if (buf.length > 12 * 1024 * 1024) return json(res, 400, { ok: false, error: 'art too large (>12MB)' })
      const target = path.join(UI_DIR(), 'art-' + side + '.webp')
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.writeFile(target, buf)
      return json(res, 200, { ok: true, side, bytes: buf.length })
    } catch (error) { return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }) }
  } }), 'eli-web.route-art-upload()')

  // ── 设置桥接：绕过官方 WEB_SETTINGS_NAMESPACES 白名单，让 eli-mode 配置卡片
  //    在任意 DSH 上开箱即用。loopback-only（客户端仅在本地连接时启用）。
  //    仅暴露 eli-mode 一个命名空间；读写都走宿主 settings 服务（与官方同源）。──
  const ELI_NS = settingsNamespace('eli-mode')
  const bridgeView = (settings, request, ns) => {
    if (settings === undefined) return json(request, 503, { ok: false, error: 'settings 服务不可用' })
    const descriptor = settings.describe({ redactSecrets: true }).find((candidate) => String(candidate.ns) === String(ns))
    if (descriptor === undefined) return json(request, 200, { ok: false, error: 'namespace not registered: eli-mode' })
    return json(request, 200, {
      ok: true,
      value: {
        ns: String(descriptor.ns),
        schema: descriptor.schema,
        ...descriptor.base === void 0 ? {} : { base: descriptor.base },
        ...descriptor.user === void 0 ? {} : { user: descriptor.user },
        value: descriptor.value,
        writable: descriptor.writable,
        revision: descriptor.revision
      }
    })
  }
  ctx.effect(() => server.register({ kind: 'exact', path: '/eli-kb/api/settings/describe', handler: async (req, res) => {
    try { bridgeView(ctx.get('settings'), res, ELI_NS) } catch (error) { json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }) }
  } }), 'eli-web.route-settings-describe()')
  ctx.effect(() => server.register({ kind: 'exact', path: '/eli-kb/api/settings/mutate', handler: async (req, res) => {
    try {
      const settings = ctx.get('settings')
      if (settings === undefined) return json(res, 503, { ok: false, error: 'settings 服务不可用' })
      const args = await readBody(req)
      try {
        await settings.mutate(ELI_NS, Array.isArray(args.ops) ? args.ops : [], args.expectedRevision)
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          return json(res, 200, { ok: false, code: 'settings-conflict', message: error.message, details: { expected: error.expected, actual: error.actual } })
        }
        return json(res, 200, { ok: false, code: 'settings-rejected', message: error instanceof Error ? error.message : String(error) })
      }
      return bridgeView(settings, res, ELI_NS)
    } catch (error) { json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }) }
  } }), 'eli-web.route-settings-mutate()')
}
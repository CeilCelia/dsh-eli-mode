// 知识库服务（host 平面）——目录层级 + [[双链]] 知识点关联。
// 存储：Markdown 文件目录（默认 ~/.dsh/eli-knowledge；ELI_KB_ROOT 可覆盖）。
//   wiki/<dir>/<name>.md —— 条目；id = 相对 wiki/ 的路径（不含 .md），可含多级目录
//   <每级目录>/index.md —— 自动生成；根 index.md = 全局树形目录（会话只注入这一页）
//   [[target]] —— 正文双链；保存时自动解析正/反向链接（target 可为完整 id 或最后一段）
import { promises as fsp } from 'node:fs'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const name = 'eli-kb'

const DEFAULT_ROOT = path.join(os.homedir(), '.dsh', 'eli-knowledge')
const SEGMENT = '[a-z0-9][a-z0-9-]*'
const ENTRY_ID = new RegExp('^' + SEGMENT + '(/' + SEGMENT + ')*$')
const WIKILINK = /\[\[([^\]]+)\]\]/g

function slugify(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function normalizeId(id) {
  if (typeof id !== 'string') return null
  const clean = id.trim().toLowerCase().replace(/\\/g, '/').replace(/\.md$/i, '')
  return ENTRY_ID.test(clean) ? clean : null
}

export class EliKb {
  constructor(root) {
    this.root = root || process.env.ELI_KB_ROOT || DEFAULT_ROOT
    this.wiki = path.join(this.root, 'wiki')
    this.indexPath = path.join(this.root, 'index.md')
  }

  async init() {
    await fsp.mkdir(this.wiki, { recursive: true })
    if (!existsSync(this.indexPath)) await this.regenerateAllIndexes()
  }

  entryPath(id) {
    return path.join(this.wiki, ...id.split('/')) + '.md'
  }

  dirAbs(rel) {
    return rel ? path.join(this.wiki, ...rel.split('/')) : this.wiki
  }

  async _readRaw(norm) {
    let raw
    try {
      raw = await fsp.readFile(this.entryPath(norm), 'utf8')
    } catch {
      return null
    }
    const lines = raw.split(/\r?\n/)
    let title = norm.split('/').pop()
    if (lines[0] && lines[0].startsWith('# ')) title = lines[0].slice(2).trim()
    const body = lines.slice(1).join('\n').replace(/^\n+/, '').trim()
    return { id: norm, title, content: '# ' + title + '\n\n' + body, body }
  }

  parseLinks(content) {
    const raw = []
    WIKILINK.lastIndex = 0
    let match
    while ((match = WIKILINK.exec(content || '')) !== null) raw.push(match[1].trim())
    return raw
  }

  async _allIds() {
    const out = []
    const walk = async (dir, prefix) => {
      let items
      try {
        items = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const item of items) {
        if (item.isDirectory()) await walk(path.join(dir, item.name), prefix + item.name + '/')
        else if (item.isFile() && item.name.endsWith('.md') && item.name !== 'index.md') out.push(prefix + item.name.slice(0, -3))
      }
    }
    await walk(this.wiki, '')
    return out.sort()
  }

  async list() {
    const out = []
    for (const id of await this._allIds()) {
      const entry = await this._readRaw(id)
      if (entry) out.push(entry)
    }
    return out
  }

  async tree() {
    const entries = await this.list()
    const root = { name: '', path: '', entries: [], children: {} }
    for (const entry of entries) {
      const parts = entry.id.split('/')
      let node = root
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i]
        if (!node.children[seg]) node.children[seg] = { name: seg, path: parts.slice(0, i + 1).join('/'), entries: [], children: {} }
        node = node.children[seg]
      }
      node.entries.push({ id: entry.id, title: entry.title })
    }
    const toJson = (node) => ({
      name: node.name,
      path: node.path,
      entries: node.entries.sort((a, b) => a.id.localeCompare(b.id)),
      children: Object.keys(node.children).sort().map((key) => toJson(node.children[key]))
    })
    return toJson(root)
  }

  async resolveTarget(raw) {
    const norm = normalizeId(raw)
    if (norm !== null && existsSync(this.entryPath(norm))) return norm
    const base = String(raw).trim().toLowerCase().split('/').pop().replace(/\.md$/i, '')
    if (base) {
      for (const id of await this._allIds()) {
        if (id.split('/').pop() === base) return id
      }
    }
    return null
  }

  async _scanLinks() {
    const rows = []
    for (const id of await this._allIds()) {
      const entry = await this._readRaw(id)
      if (!entry) continue
      const targets = []
      for (const raw of this.parseLinks(entry.content)) {
        const resolved = await this.resolveTarget(raw)
        if (resolved !== null && !targets.includes(resolved)) targets.push(resolved)
      }
      rows.push({ id, title: entry.title, targets })
    }
    return rows
  }

  async read(id) {
    const norm = normalizeId(id)
    if (norm === null) return null
    const entry = await this._readRaw(norm)
    if (entry === null) return null
    const links = []
    for (const raw of this.parseLinks(entry.content)) {
      const resolved = await this.resolveTarget(raw)
      if (resolved !== null) {
        const target = await this._readRaw(resolved)
        links.push({ id: resolved, title: target ? target.title : resolved })
      }
    }
    return { ...entry, links, backlinks: await this.backlinksOf(norm) }
  }

  async backlinksOf(id) {
    const norm = normalizeId(id)
    if (norm === null) return []
    const out = []
    for (const row of await this._scanLinks()) {
      if (row.id !== norm && row.targets.includes(norm)) out.push({ id: row.id, title: row.title })
    }
    return out
  }

  excerptOf(entry) {
    const text = (entry.body || entry.content || '').replace(/^#.*$/m, '').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\s+/g, ' ').trim()
    return text.length > 120 ? text.slice(0, 120) + '…' : text
  }

  async search(query) {
    const q = String(query || '').trim().toLowerCase()
    const entries = await this.list()
    if (q.length === 0) return entries.map((entry) => ({ id: entry.id, title: entry.title, excerpt: this.excerptOf(entry) })).slice(0, 30)
    const scored = []
    for (const entry of entries) {
      const haystack = (entry.title + '\n' + entry.content).toLowerCase()
      if (!haystack.includes(q)) continue
      let score = 1
      if (entry.title.toLowerCase().includes(q)) score += 5
      if (entry.id.includes(q)) score += 3
      scored.push({ entry, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 30).map(({ entry }) => ({ id: entry.id, title: entry.title, excerpt: this.excerptOf(entry) }))
  }

  async write(id, title, content) {
    const safeTitle = String(title || '').trim()
    if (safeTitle.length === 0) throw new Error('eli-kb: title is required')
    const norm = normalizeId(id)
    const safeId = norm !== null ? norm : (slugify(safeTitle) || 'entry-' + Date.now().toString(36))
    let body = String(content ?? '').trim()
    const firstLine = body.split(/\r?\n/, 1)[0]
    if (firstLine && firstLine.startsWith('# ')) body = body.replace(/^# [^\n]*\n?/, '').trim()
    const target = this.entryPath(safeId)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, '# ' + safeTitle + '\n\n' + body + '\n', 'utf8')
    await this.regenerateAllIndexes()
    return safeId
  }

  async remove(id) {
    const norm = normalizeId(id)
    if (norm === null) return false
    try {
      await fsp.unlink(this.entryPath(norm))
    } catch {
      return false
    }
    let dir = path.dirname(this.entryPath(norm))
    while (dir !== this.wiki && dir.startsWith(this.wiki)) {
      try {
        const rest = await fsp.readdir(dir)
        if (rest.length === 0) {
          await fsp.rmdir(dir)
          dir = path.dirname(dir)
        } else break
      } catch {
        break
      }
    }
    await this.regenerateAllIndexes()
    return true
  }

  async index() {
    try {
      return readFileSync(this.indexPath, 'utf8')
    } catch {
      return ''
    }
  }

  async regenerateAllIndexes() {
    const dirs = ['']
    const walk = async (rel) => {
      let items
      try {
        items = await fsp.readdir(this.dirAbs(rel), { withFileTypes: true })
      } catch {
        return
      }
      for (const item of items) {
        if (item.isDirectory()) {
          const sub = rel ? rel + '/' + item.name : item.name
          dirs.push(sub)
          await walk(sub)
        }
      }
    }
    await walk('')
    for (const rel of dirs) await this.writeDirIndex(rel)
    await this.writeGlobalIndex()
    return this.indexPath
  }

  async writeDirIndex(rel) {
    const abs = this.dirAbs(rel)
    const entries = []
    const subs = []
    let items
    try {
      items = await fsp.readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      if (item.isDirectory()) subs.push(item.name)
      else if (item.isFile() && item.name.endsWith('.md') && item.name !== 'index.md') {
        const id = rel ? rel + '/' + item.name.slice(0, -3) : item.name.slice(0, -3)
        const entry = await this._readRaw(id)
        if (entry) entries.push(entry)
      }
    }
    entries.sort((a, b) => a.id.localeCompare(b.id))
    const lines = ['# ' + (rel ? rel.split('/').pop() : '根') + ' 目录']
    if (entries.length === 0 && subs.length === 0) lines.push('（空）')
    for (const sub of subs.sort()) lines.push('📁 ' + sub + '/')
    for (const entry of entries) lines.push('- ' + entry.id + ' — ' + entry.title)
    await fsp.mkdir(abs, { recursive: true })
    await fsp.writeFile(path.join(abs, 'index.md'), lines.join('\n') + '\n', 'utf8')
  }

  async writeGlobalIndex() {
    const groups = {}
    for (const entry of await this.list()) {
      const dir = entry.id.includes('/') ? entry.id.slice(0, entry.id.lastIndexOf('/')) : ''
      ;(groups[dir] = groups[dir] || []).push(entry)
    }
    const lines = ['# Eli 知识库']
    const dirs = Object.keys(groups).sort()
    if (dirs.length === 0) {
      lines.push('（暂无条目）')
    }
    for (const dir of dirs) {
      if (dir) lines.push('', '## ' + dir)
      for (const entry of groups[dir]) lines.push('- ' + entry.id + ' — ' + entry.title)
    }
    await fsp.mkdir(this.root, { recursive: true })
    await fsp.writeFile(this.indexPath, lines.join('\n') + '\n', 'utf8')
  }
}

export function apply(ctx, config = {}) {
  const service = new EliKb(config.root)
  // 余额查询：读 dsh 凭据服务（DEEPSEEK_API_KEY），没有则回退环境变量；无 key 返回明确错误
  service.getBalance = async () => {
    try {
      const cred = ctx.get('credentials')
      let key
      if (cred !== undefined) {
        const hit = await cred.resolve('DEEPSEEK_API_KEY')
        if (hit !== undefined && hit.value && hit.value.length > 0) key = hit.value
      }
      if (key === undefined || key.length === 0) key = process.env.DEEPSEEK_API_KEY
      if (key === undefined || key.length === 0) return { ok: false, error: 'no DeepSeek API key (set DEEPSEEK_API_KEY or configure the credentials service)' }
      const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
      const resp = await fetch(base + '/user/balance', { headers: { authorization: 'Bearer ' + key } })
      if (!resp.ok) return { ok: false, error: 'balance HTTP ' + resp.status }
      const data = await resp.json()
      const info = Array.isArray(data.balance_infos) ? data.balance_infos[0] : undefined
      const total = info ? Number(info.total_balance ?? 0) : 0
      const topped = info ? Number(info.topped_up_balance ?? 0) : 0
      const currency = info && info.currency ? info.currency : 'CNY'
      const spent = topped > total ? +(topped - total).toFixed(4) : null
      return { ok: true, balance: total, currency, spent }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  ctx.effect(() => ctx.provide('eliKb', service), 'eli-kb.provide()')
  void service.init().catch((error) => {
    ctx.logger?.warn?.('eli-kb init failed: ' + (error instanceof Error ? error.message : String(error)))
  })
}

// eli-mode 工具调用链合并（eli-toolchain）冒烟测试——polish 门控版：
// 验证 polish=false 时不挂观察器（不改 DOM）；polish=true 时连续 tool-call 归组、
// 流式追加并入、点击展开切换、孤立调用不动；关回 polish 后清理现场。
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const src = readFileSync(path.join('C:', 'Users', 'Administrator', 'Documents', 'dsh', 'dsh-eli-mode', 'packages', 'eli-mode', 'lib', 'client.js'), 'utf8')

// ── 迷你 DOM ──
class MiniEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.nodeType = 1
    this.children = []
    this.parent = null
    this.dataset = {}
    this._classes = new Set()
    this._attrs = {}
    this._listeners = {}
    this._text = ''
  }
  get classList() {
    return {
      add: (c) => this._classes.add(c),
      contains: (c) => this._classes.has(c),
      remove: (c) => this._classes.delete(c),
    }
  }
  set className(v) { this._className = String(v); this._classes = new Set(String(v).split(/\s+/).filter(Boolean)) }
  get className() { return this._className || '' }
  matches(sel) {
    if (sel === '[data-chat-flow-kind="tool-call"]') return this._attrs['data-chat-flow-kind'] === 'tool-call'
    if (sel.startsWith('.')) return this._classes.has(sel.slice(1))
    if (sel.startsWith('style[')) return false
    return false
  }
  get nextElementSibling() {
    const i = this.parent ? this.parent.children.indexOf(this) : -1
    return i >= 0 && i + 1 < this.parent.children.length ? this.parent.children[i + 1] : null
  }
  get previousElementSibling() {
    const i = this.parent ? this.parent.children.indexOf(this) : -1
    return i > 0 ? this.parent.children[i - 1] : null
  }
  before(el) {
    const i = this.parent ? this.parent.children.indexOf(this) : -1
    this.parent.children.splice(i, 0, el)
    el.parent = this.parent
  }
  appendChild(el) { el.parent = this; this.children.push(el) }
  remove() { const i = this.parent ? this.parent.children.indexOf(this) : -1; if (i >= 0) this.parent.children.splice(i, 1) }
  setAttribute(k, v) { this._attrs[k] = String(v) }
  getAttribute(k) { return this._attrs[k] }
  addEventListener(ev, fn) { this._listeners[ev] = fn }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  querySelectorAll(sel) {
    const out = []
    const walk = (el) => { for (const c of el.children) { if (c.matches(sel)) out.push(c); walk(c) } }
    walk(this)
    return out
  }
  get textContent() {
    if (this._text !== '') return this._text
    return this.children.map((c) => c.textContent).join('')
  }
  set textContent(v) { this._text = String(v) }
}

const head = new MiniEl('head')
const body = new MiniEl('body')
let observerCb = null
globalThis.document = {
  body,
  head,
  createElement: (t) => new MiniEl(t),
  querySelector: (sel) => (sel.startsWith('style[') ? null : body.querySelector(sel)),
  querySelectorAll: (sel) => body.querySelectorAll(sel),
}
globalThis.MutationObserver = class {
  constructor(cb) { observerCb = cb }
  observe() {}
  disconnect() { observerCb = null }
}
let pendingTimer = null
globalThis.setTimeout = (fn) => { pendingTimer = fn; return 1 }
globalThis.clearTimeout = () => { pendingTimer = null }
const fireTimers = () => { const fn = pendingTimer; pendingTimer = null; if (fn) fn() }

const reactMock = { createElement: () => ({}), useState: (v) => [v, () => {}], useEffect: () => {} }
const requireMock = (spec) => {
  if (spec === 'react') return reactMock
  throw new Error('unexpected require: ' + spec)
}
const fn = new Function('require', src.replace(/^window\.__ModuleLoader__\.load\(/, 'return ').replace(/\);\s*$/, ';'))
const moduleExports = fn(requireMock).factory(requireMock)

// ── 场景 0：polish=false → 不挂观察器、不改 DOM ──
let snapshot = { status: 'ready', value: { polish: false }, user: {}, writable: true, revision: 1 }
const scope = {
  getSnapshot: () => snapshot,
  subscribe: (cb) => { scope._fn = cb; return () => { scope._fn = undefined } },
  set: async () => {}, unset: async () => {},
}
const binder = { bind: (spec) => { if (spec.namespace !== 'eli-mode') throw new Error('ns'); return scope } }
const slots = {
  inject: (name, cb) => { slots.regs = slots.regs || []; slots.regs.push({ name, cb }); return () => {} },
  register: (opts, comp) => ({ ...opts, component: comp }),
}
moduleExports.apply({ get: (n) => n === 'settingsScope' ? binder : n === 'slots' ? slots : undefined })
const flow0 = new MiniEl('div')
body.appendChild(flow0)
for (let i = 0; i < 3; i++) { const r = new MiniEl('div'); r.setAttribute('data-chat-flow-kind', 'tool-call'); flow0.appendChild(r) }
fireTimers()
if (observerCb !== null) throw new Error('polish=false 时不应挂观察器')
if (flow0.querySelectorAll('.eli-toolchain-run').length !== 0) throw new Error('polish=false 时不应插入摘要')
console.log('场景0 OK：polish=false → 无观察器、DOM 未动')

// ── 场景 1-3：polish=true → 归组 / 追加并入 / 展开切换 ──
snapshot = { status: 'ready', value: { polish: true }, user: {}, writable: true, revision: 2 }
scope._fn && scope._fn() // 触发 syncPolish → 挂观察器 + 注册槽位
if (observerCb === null) throw new Error('polish=true 时应挂观察器')
if (!slots.regs.some((r) => r.name === 'conversation.view')) throw new Error('polish 槽位未注册（知识库标签页）')
if (!slots.regs.some((r) => r.name === 'conversation.composer.dock')) throw new Error('polish 槽位未注册（dock 统计）')
console.log('polish=true → 观察器与槽位就绪')

const flow = new MiniEl('div')
body.appendChild(flow)
for (let i = 1; i <= 3; i++) { const r = new MiniEl('div'); r.setAttribute('data-chat-flow-kind', 'tool-call'); flow.appendChild(r) }
observerCb()
fireTimers()
const grouped = flow.children.filter((c) => c.classList.contains('eli-toolchain-call'))
if (grouped.length !== 3) throw new Error('归组数不对: ' + grouped.length)
const summary = flow.children.find((c) => c.classList.contains('eli-toolchain-run'))
if (!summary || summary.dataset.count !== '3') throw new Error('摘要未正确插入')
console.log('场景1 OK：3 连调用归组「' + summary.textContent + '」')

const row4 = new MiniEl('div')
row4.setAttribute('data-chat-flow-kind', 'tool-call')
flow.appendChild(row4)
observerCb()
fireTimers()
const summaries = flow.children.filter((c) => c.classList.contains('eli-toolchain-run'))
if (summaries.length !== 1 || summaries[0].dataset.count !== '4') throw new Error('追加未并入: ' + summaries.length)
console.log('场景2 OK：追加调用并入，计数 ×4')

summaries[0]._listeners.click()
if (summaries[0].dataset.eliOpen !== 'true') throw new Error('点击未展开')
summaries[0]._listeners.click()
if (summaries[0].dataset.eliOpen !== 'false') throw new Error('再点未收起')
console.log('场景3 OK：点击展开/收起切换')

// ── 场景 4：关回 polish → 现场清理 ──
snapshot = { status: 'ready', value: { polish: false }, user: {}, writable: true, revision: 3 }
scope._fn && scope._fn()
if (observerCb !== null) throw new Error('关闭 polish 后观察器应断开')
if (flow.children.some((c) => c.classList.contains('eli-toolchain-run'))) throw new Error('关闭后摘要应移除')
if (flow.children.some((c) => c.classList.contains('eli-toolchain-call'))) throw new Error('关闭后行类应清理')
console.log('场景4 OK：关闭 polish → 观察器断开、摘要与类清理')
console.log('ALL TOOLCHAIN TESTS PASSED')

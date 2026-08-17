// eli-mode client 桥接冒烟：官方 settingsScope 永久 loading（命名空间未白名单）时，
// 内置 loopback 设置桥（fetchFn 恒启用）必须接管，且任何失败路径不得永久「加载中」。
// 覆盖：
//   A) 桥接 ready  → 卡片可用（available+exposed）
//   B) 桥接被拒    → 4s 兜底后 unavailable（notExposed，非永久 loading）
//   C) 桥接挂起    → 4s 兜底后 unavailable（notExposed，非永久 loading）
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, 'lib', 'client.js'), 'utf8')

// mock window + loader + setTimeout（4s 兜底手动放行）
let captured = null
globalThis.window = { __ModuleLoader__: { load: (entry) => { captured = entry } } }
let pendingTimer = null
globalThis.setTimeout = (fn) => { pendingTimer = fn; return 1 }
const firePending = () => { const fn = pendingTimer; pendingTimer = null; if (fn) fn() }

const reactMock = {
  createElement: (...args) => ({ type: args[0], props: args[1], children: args.slice(2) }),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
}
const requireMock = (spec) => {
  if (spec === 'react') return reactMock
  throw new Error('unexpected require: ' + spec)
}
const fn = new Function('require', src.replace(/^window\.__ModuleLoader__\.load\(/, 'return ').replace(/\);\s*$/, ';'))
const factory = fn(requireMock).factory
const moduleExports = factory(requireMock)

// primary 永久 loading：模拟官方 scope 对未白名单命名空间的卡死行为
const primaryMock = {
  getSnapshot: () => ({ status: 'loading', value: void 0, user: void 0, writable: false, revision: void 0 }),
  subscribe: () => () => {},
  set: async () => {}, unset: async () => {},
}
const settingsScopeMock = { bind: (spec) => { if (spec.namespace !== 'eli-mode') throw new Error('wrong ns: ' + spec.namespace); return primaryMock } }

function mountOnce() {
  const registrations = []
  let capturedComponent = null
  const slotsMock = {
    inject: (name, cb) => registrations.push({ name, cb }),
    register: (opts, comp) => { capturedComponent = comp; return { ...opts, component: comp } },
  }
  const ctx = { get: (name) => name === 'settingsScope' ? settingsScopeMock : name === 'slots' ? slotsMock : undefined }
  moduleExports.apply(ctx)
  const card = registrations.find((r) => r.name === 'settings.plugin.item')
  if (!card) throw new Error('卡片未注册')
  const entry = card.cb()
  return entry.inject().hooks.eliModeCard
}

const tick = () => new Promise((resolve) => setImmediate(resolve))
const waitFor = async (pred, label, max = 100) => {
  for (let i = 0; i < max; i++) { if (pred()) return; await tick() }
  throw new Error('等待超时: ' + label)
}

// ── A) 桥接 ready：卡片可用 ──
globalThis.fetch = async () => ({ json: async () => ({ result: { ok: true, value: { value: { personaPrompt: '桥接人格', kbIndex: true, polish: false }, base: {}, user: {}, writable: true, revision: 7 } } }) })
const faceA = mountOnce()
await waitFor(() => faceA.getSnapshot().exposed === true, 'A 桥接 ready')
const snapA = faceA.getSnapshot()
if (!snapA.available || !snapA.exposed || snapA.personaPrompt.text !== '桥接人格') throw new Error('A 桥接接管失败: ' + JSON.stringify(snapA))
console.log('A OK: primary loading + 桥接 ready → 卡片可用（' + snapA.personaPrompt.text + '）')

// ── B) 桥接被拒（host 非 loopback 拒绝）：4s 后 unavailable，非永久 loading ──
globalThis.fetch = async () => ({ json: async () => ({ result: { ok: false, code: 'forbidden' } }) })
const faceB = mountOnce()
await tick() // 桥接 read 结算为 unavailable
if (faceB.getSnapshot().available !== false) throw new Error('B 应在兜底前保持 loading')
firePending() // 放行 4s 兜底
await tick()
const snapB = faceB.getSnapshot()
if (!snapB.available || snapB.exposed !== false) throw new Error('B 兜底未生效: ' + JSON.stringify(snapB))
console.log('B OK: 桥接被拒 → 4s 兜底 → notExposed（非永久 loading）')

// ── C) 桥接挂起（fetch 永不返回）：4s 后 unavailable ──
globalThis.fetch = () => new Promise(() => {})
const faceC = mountOnce()
await tick()
if (faceC.getSnapshot().available !== false) throw new Error('C 应在兜底前保持 loading')
firePending()
await tick()
const snapC = faceC.getSnapshot()
if (!snapC.available || snapC.exposed !== false) throw new Error('C 兜底未生效: ' + JSON.stringify(snapC))
console.log('C OK: 桥接挂起 → 4s 兜底 → notExposed（非永久 loading）')

console.log('ALL BRIDGE SMOKE TESTS PASSED')

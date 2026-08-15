// eli-polish client 冒烟测试：模拟浏览器模块加载器执行工厂，验证
// 1) 工厂体无运行时错误 2) 无服务时优雅降级 3) 有服务时正常注册卡片。
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const src = readFileSync(path.join('C:', 'Users', 'Administrator', 'Documents', 'dsh', 'dsh-eli-mode', 'packages', 'eli-mode', 'lib', 'client.js'), 'utf8')

// mock window + loader
let captured = null
globalThis.window = {
  __ModuleLoader__: { load: (entry) => { captured = entry } },
}

// mock setTimeout：存回调、手动触发（重试定时器不自动跑，超时竞速可手动放行）
let pendingTimer = null
globalThis.setTimeout = (fn) => { pendingTimer = fn; return 1 }
const firePending = () => { const fn = pendingTimer; pendingTimer = null; if (fn) fn() }

// mock require：react 返回最小 mock
const reactMock = {
  createElement: (...args) => ({ type: args[0], props: args[1], children: args.slice(2) }),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
}
const requireMock = (spec) => {
  if (spec === 'react') return reactMock
  throw new Error('unexpected require: ' + spec)
}

// 执行工厂
const fn = new Function('require', src.replace(/^window\.__ModuleLoader__\.load\(/, 'return ').replace(/\);\s*$/, ';'))
const loaded = fn(requireMock)
const factory = loaded.factory
const moduleExports = factory(requireMock)

if (typeof moduleExports.apply !== 'function') throw new Error('apply 未导出')
console.log('factory OK: apply exported')

// ── 路径 1：无服务，优雅降级 ──
const noServiceCtx = { get: (name) => undefined }
moduleExports.apply(noServiceCtx)
console.log('degrade path OK: no throw without services')

// ── 路径 2：有 slots + settingsScope，应注册卡片 ──
const registrations = []
let capturedComponent = null
const slotsMock = {
  inject: (name, cb) => registrations.push({ name, cb }),
  register: (opts, comp) => {
    if (typeof opts.id !== 'string' || typeof opts.name !== 'string') throw new Error('register 缺 id/name: ' + JSON.stringify(opts))
    if (typeof comp !== 'function') throw new Error('register 缺组件')
    if (typeof opts.inject !== 'function') throw new Error('register 缺 inject 面（组件将拿不到 hook/动作）')
    capturedComponent = comp
    return { ...opts, component: comp }
  },
}
let snapshotValue = { status: 'loading', value: undefined, user: undefined, writable: true, revision: 1 }
const scopeMock = {
  getSnapshot: () => snapshotValue,
  subscribe: (fn) => { scopeMock._fn = fn; return () => { scopeMock._fn = undefined } },
  set: async (field, value) => {
    if (scopeMock.hang) return new Promise(() => {}) // 模拟写入永不返回
    snapshotValue = { ...snapshotValue, status: 'ready', value: { ...snapshotValue.value, [field]: value }, user: { ...(snapshotValue.user || {}), [field]: value } }; scopeMock._fn && scopeMock._fn()
  },
  unset: async (field) => { const u = { ...(snapshotValue.user || {}) }; delete u[field]; snapshotValue = { ...snapshotValue, user: u }; scopeMock._fn && scopeMock._fn() },
}
const settingsScopeMock = { bind: (spec) => { if (spec.namespace !== 'eli-mode') throw new Error('wrong ns: ' + spec.namespace); return scopeMock } }
const serviceCtx = { get: (name) => name === 'settingsScope' ? settingsScopeMock : name === 'slots' ? slotsMock : undefined }

moduleExports.apply(serviceCtx)
if (registrations.some(r => r.name === 'web-ui.plugin.item')) throw new Error('卡片不应注册进 web-ui.plugin.item 组（Eli Mode 不是全家桶插件）')
const card = registrations.find(r => r.name === 'settings.plugin.item')
if (!card) throw new Error('settings.plugin.item 卡片未注册')
console.log('card registered: settings.plugin.item (top-level)')
const entry = card.cb() // 触发注册回调 → 应调用 slots.register 且不抛错
if (typeof entry.inject !== 'function') throw new Error('slot 条目缺 inject')
const face = entry.inject()
if (!face.hooks || typeof face.hooks.eliModeCard !== 'object') throw new Error('inject 面缺 hooks.eliModeCard')
if (typeof face.save !== 'function' || typeof face.edit !== 'function' || typeof face.discard !== 'function') throw new Error('inject 面缺动作')
console.log('slot inject face OK (hooks.eliModeCard + actions)')

// ── 路径 3：scope 就绪后渲染组件（mock React，走组件函数体）──
snapshotValue = { status: 'ready', value: { personaPrompt: '测试人格', kbIndex: true }, user: {}, writable: true, revision: 2 }
scopeMock._fn && scopeMock._fn()
if (typeof capturedComponent !== 'function') throw new Error('组件未捕获')
const baseProps = {
  edit: () => {},
  resetField: () => {},
  save: () => {},
  discard: () => {},
  useEliModeCard: (sel) => sel({ available: true, exposed: true, writable: true, dirty: false, invalid: false, saving: false, failed: false, personaPrompt: { text: '测试人格', overridden: false, invalid: false }, kbIndexPrompt: { text: '目录如下：\n\n{{tree}}', overridden: false, invalid: false }, kbIndex: { text: true, overridden: false, invalid: false }, polish: { text: false, overridden: false, invalid: false } }),
}
capturedComponent(baseProps) // exposed 状态渲染
capturedComponent({ ...baseProps, useEliModeCard: (sel) => sel({ available: false, exposed: false, writable: true }) }) // 加载中/未暴露状态
console.log('component render OK (exposed + unavailable states)')

// ── 路径 4：写入永不返回 → 保存不能卡死（10s 超时兜底）──
pendingTimer = null
face.edit('personaPrompt', '新人格正文')
scopeMock.hang = true
face.save() // 不 await：触发保存流程
const snapDuring = face.hooks.eliModeCard.getSnapshot()
if (snapDuring.saving !== true) throw new Error('保存中状态未进入: ' + JSON.stringify(snapDuring))
console.log('保存中状态 OK（此时 UI 显示「保存中…」）')
await new Promise((resolve) => setImmediate(resolve)) // 让 save 的写入路径开始挂起
if (typeof pendingTimer !== 'function') throw new Error('未注册超时定时器')
firePending() // 触发 10s 超时（测试中手动放行）
await new Promise((resolve) => setImmediate(resolve))
const snapAfter = face.hooks.eliModeCard.getSnapshot()
if (snapAfter.saving !== false) throw new Error('保存后仍卡在 saving: ' + JSON.stringify(snapAfter))
if (snapAfter.failed !== true) throw new Error('应标记失败: ' + JSON.stringify(snapAfter))
if (snapAfter.failText !== 'save.timeout') throw new Error('缺超时 key: ' + snapAfter.failText)
console.log('超时兜底 OK：saving 复位、失败提示「' + snapAfter.failText + '」')
scopeMock.hang = false

// ── 路径 5：正常保存应成功（值写入、草稿清空）──
face.edit('kbIndexPrompt', '模板：\n\n{{tree}}')
face.save()
let snapOk = null
for (let i = 0; i < 50; i++) {
  await new Promise((resolve) => setImmediate(resolve))
  snapOk = face.hooks.eliModeCard.getSnapshot()
  if (snapOk.saving === false) break
}
if (snapOk === null || snapOk.saving !== false || snapOk.failed !== false) throw new Error('正常保存失败: ' + JSON.stringify(snapOk))
if (snapOk.dirty) throw new Error('保存后草稿应清空（dirty=false）')
if (snapshotValue.value.kbIndexPrompt !== '模板：\n\n{{tree}}') throw new Error('值未写入 scope: ' + JSON.stringify(snapshotValue.value))
console.log('正常保存 OK：写入生效、草稿清空')
console.log('ALL SMOKE TESTS PASSED')

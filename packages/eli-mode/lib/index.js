// dsh-eli-mode host 入口：
// 1) 注册 eli-mode 设置命名空间（「插件-插件配置」管理页的后端）；
// 2) 把包内 presets/ 同步到 ~/.dsh/.agent-presets/（预设选择器即可用，升级自动更新）；
// 3) 首次运行把包内 wiki/ 与 ui/ 播种到 ~/.dsh/eli-knowledge/（已有内容绝不覆盖）。
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_KB_TEMPLATE, DEFAULT_PERSONA, ELI_MODE_KEY } from './eli-settings.js'

const PKG_DIR = path.dirname(fileURLToPath(import.meta.url))
const PRESETS_ROOT = path.join(PKG_DIR, '..', 'presets')
const WIKI_DIR = path.join(PKG_DIR, '..', 'wiki')
const UI_DIR = path.join(PKG_DIR, '..', 'ui')
const AGENT_PRESETS_ROOT = () => path.join(os.homedir(), '.dsh', '.agent-presets')
const KB_ROOT = () => process.env.ELI_KB_ROOT || path.join(os.homedir(), '.dsh', 'eli-knowledge')

export const ELI_MODE_NAMESPACE = settingsNamespace(ELI_MODE_KEY)

export const EliModeSchema = z.object({
  personaPrompt: z
    .string()
    .description('人格 prompt（身份/风格/记忆规则）。Role/User/工作目录/日期由系统自动生成，无需包含。改后新会话生效。')
    .default(DEFAULT_PERSONA),
  kbIndexPrompt: z
    .string()
    .description('知识库注入 prompt 模板，{{tree}} 会被知识库目录清单替换。改后新会话生效。')
    .default(DEFAULT_KB_TEMPLATE),
  kbIndex: z
    .boolean()
    .description('是否在会话提示词中注入知识库目录清单')
    .default(true),
  polish: z
    .boolean()
    .description('界面润色：立绘、对话内知识库标签页、token 统计、工具调用折叠。默认关闭，不改动默认 UI。')
    .default(false),
})

function filesEqual(a, b) {
  try {
    return readFileSync(a).equals(readFileSync(b))
  } catch {
    return false
  }
}

/** 把一个预设目录的每个文件同步到目标（缺省或字节不同才写，幂等）。 */
function syncOnePreset(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true })
  let changed = false
  const walk = (src, dst) => {
    for (const name of readdirSync(src)) {
      const s = path.join(src, name)
      const d = path.join(dst, name)
      if (statSync(s).isDirectory()) {
        mkdirSync(d, { recursive: true })
        walk(s, d)
      } else if (!existsSync(d) || !filesEqual(s, d)) {
        cpSync(s, d)
        changed = true
      }
    }
  }
  walk(sourceDir, targetDir)
  return changed
}

/** 同步包内 presets/ 全部预设到 ~/.dsh/.agent-presets/。 */
export function syncPresets() {
  const targetRoot = AGENT_PRESETS_ROOT()
  mkdirSync(targetRoot, { recursive: true })
  if (!existsSync(PRESETS_ROOT)) return []
  const synced = []
  for (const id of readdirSync(PRESETS_ROOT)) {
    const source = path.join(PRESETS_ROOT, id)
    if (!statSync(source).isDirectory()) continue
    if (syncOnePreset(source, path.join(targetRoot, id))) synced.push(id)
  }
  return synced
}

/** 首次运行播种默认知识库（wiki 条目 + ui 页面/立绘）；已有 index.md 则不动作。 */
export function seedKnowledgeBase() {
  const root = KB_ROOT()
  if (existsSync(path.join(root, 'index.md'))) return
  mkdirSync(root, { recursive: true })
  const copyTree = (src, dst) => {
    if (!existsSync(src)) return
    mkdirSync(dst, { recursive: true })
    for (const name of readdirSync(src)) {
      const s = path.join(src, name)
      const d = path.join(dst, name)
      if (statSync(s).isDirectory()) copyTree(s, d)
      else if (!existsSync(d)) cpSync(s, d)
    }
  }
  copyTree(WIKI_DIR, path.join(root, 'wiki'))
  copyTree(UI_DIR, path.join(root, 'ui'))
}

export function apply(ctx) {
  try {
    syncPresets()
    seedKnowledgeBase()
  } catch (error) {
    ctx.logger?.warn?.('eli-mode host init failed: ' + (error instanceof Error ? error.message : String(error)))
  }
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(ELI_MODE_NAMESPACE, EliModeSchema)
  })
}

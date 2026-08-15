// 提示词注入（preset 平面）：
// - 会话只注入知识库目录清单（精简格式，每次组装实时读文件）；
// - 遮蔽全局环境段落（harness:identity / harness:source / app:web-surface），去掉平台噪声；
// - 注册 {{date}} 变量，保证 persona 里的“今天是 {{date}}”可解析。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DEFAULT_KB_TEMPLATE, readEliSetting } from './eli-settings.js'

export const name = 'eli-wiki-index'
export const inject = ['systemPrompt']

const DEFAULT_ROOT = path.join(os.homedir(), '.dsh', 'eli-knowledge')

export function apply(ctx, config = {}) {
  const root = config.root || process.env.ELI_KB_ROOT || DEFAULT_ROOT
  const indexPath = path.join(root, 'index.md')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'eli:kb-index',
    order: 50,
    text: () => {
      // eli-mode.kbIndex 为 false 时不注入知识库目录清单（管理页可关）
      if (readEliSetting('kbIndex') === false) return ''
      try {
        const text = readFileSync(indexPath, 'utf8')
        if (text.trim().length === 0) return ''
        // 精简：剥掉文件标题与说明行，只留目录清单
        const lines = text.split(/\r?\n/)
        while (lines.length > 0) {
          const line = lines[0].trim()
          if (line.length === 0 || line.startsWith('# ') || line.startsWith('>')) lines.shift()
          else break
        }
        const tree = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
        if (tree.length === 0) return ''
        // eli-mode.kbIndexPrompt 为模板（{{tree}} 占位被目录清单替换）；空模板 = 不注入
        const template = readEliSetting('kbIndexPrompt')
        if (template === '') return ''
        const tpl = typeof template === 'string' ? template : DEFAULT_KB_TEMPLATE
        return tpl.includes('{{tree}}') ? tpl.replaceAll('{{tree}}', tree) : tpl + '\n\n' + tree
      } catch {
        return ''
      }
    }
  }), 'eli-wiki-index.section()')

  // 遮蔽全局平台段落：同名 scoped section 覆盖 global。
  // identity / web-surface 置空（persona 已含身份与用户信息，避免重复）；source 保留一行。
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'harness:identity',
    order: -100,
    text: ''
  }), 'eli-wiki-index.shadow-identity()')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'harness:source',
    order: -90,
    text: ''
  }), 'eli-wiki-index.shadow-source()')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'app:web-surface',
    order: -80,
    text: ''
  }), 'eli-wiki-index.shadow-web()')

  // 策略上下文压成两行（同名 scoped context 覆盖 global 的长文）。
  ctx.effect(() => ctx.systemPrompt.context({
    name: 'sandbox:policy',
    order: -70,
    text: '文件沙箱：workspace-write，工作区外写入需批准。'
  }), 'eli-wiki-index.shadow-sandbox()')
  ctx.effect(() => ctx.systemPrompt.context({
    name: 'approval:policy',
    order: -60,
    text: '需批准的操作会请求用户确认。'
  }), 'eli-wiki-index.shadow-approval()')

  ctx.effect(() => ctx.systemPrompt.variable('date', () => {
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
  }), 'eli-wiki-index.date()')
}

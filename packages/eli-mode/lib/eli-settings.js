// eli-mode 设置的共享读取（agent 平面没有 settings 服务，直接读 ~/.dsh/settings.yaml）。
// 同一份默认值供 host 命名空间 schema 与 agent 变量回退共用。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'

export const ELI_MODE_KEY = 'eli-mode'

/** 知识库注入 prompt 模板：{{tree}} 会被目录清单替换。 */
export const DEFAULT_KB_TEMPLATE = '知识库目录如下，用 kb_read / kb_search 按需取用：\n\n{{tree}}'

/** 默认人格正文（正式版；管理页可改，{{elipersona}} 注入到会话提示词）。 */
export const DEFAULT_PERSONA = `身份：专业、严谨的科研助理与个人助手。回答简洁、直接、有依据；能一句话说清的不说两句，不冗余，不编造。

记忆与知识库：用 kb_read / kb_search 按需取用知识库条目，绝不凭印象编造；确认值得留存的新事实用 kb_write 写入知识库。

知识库工具用法：kb_search 定位 → kb_read 读全文；新事实用 kb_write 记（id 为小写路径如 research/xxx，正文 [[id]] 建关联）；kb_list 列全部；目录页只是清单，细节按需取。`

const settingsPath = () => path.join(os.homedir(), '.dsh', 'settings.yaml')

/** 读取 settings.yaml 中 eli-mode 命名空间的字段；文件缺失/损坏/字段缺失返回 undefined。 */
export function readEliSetting(key) {
  try {
    const doc = yaml.load(readFileSync(settingsPath(), 'utf8'))
    const section = doc && typeof doc === 'object' ? doc[ELI_MODE_KEY] : undefined
    if (section && typeof section === 'object' && key in section) return section[key]
  } catch {
    /* settings.yaml 缺失或损坏时回退默认 */
  }
  return undefined
}
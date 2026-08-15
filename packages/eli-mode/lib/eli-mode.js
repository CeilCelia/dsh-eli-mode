// Eli Mode 管理页（agent 平面）：注册 {{elipersona}} 变量。
// 人格正文取 ~/.dsh/settings.yaml 的 eli-mode.personaPrompt（缺省回退内置默认），
// 在 agent.cordis.yml 的 persona.text 中以 {{elipersona}} 引用。
import { DEFAULT_PERSONA, readEliSetting } from './eli-settings.js'

export const name = 'eli-mode'
export const inject = ['systemPrompt']

export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.variable('elipersona', () => readEliSetting('personaPrompt') ?? DEFAULT_PERSONA), 'eli-mode.persona()')
}

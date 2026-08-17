/**
 * 精简系统注入：遮蔽 dsh 官方 tool:* 引导段中与工具 schema 描述重复的部分。
 *
 * 官方引导由 @deepseek-ai/dsh-tool-fs 等以 ctx.systemPrompt.section() 注册在
 * global 层；本模块在 preset 层注册同名 section，按 scope 近者遮蔽远者，
 * 把注入里的冗余引导压到只剩 schema 没有的独特信息。
 */
export const name = 'eli-prompt-trim'
export const inject = ['systemPrompt']

const SECTIONS = {
	'tool:read': 'Large files: page with offset/limit.',
	'tool:write': 'Read the target first; prefer edit for targeted changes.',
	'tool:edit': 'Read the file before editing (skip only files you just created).',
	'tool:glob': 'Patterns without "/" match basenames at any depth; results are files only (hidden included), in modification-time order.',
	'tool:grep': 'After a match, read the file for surrounding context.',
}

export function apply(ctx) {
	for (const [name, text] of Object.entries(SECTIONS)) {
		ctx.effect(() => ctx.systemPrompt.section({ name, order: 100, text }), `prompt-trim:${name}`)
	}
}

// 知识库工具（preset 平面）——注册 kb_read / kb_search / kb_write / kb_list 到本 agent 的工具层。
// 消费 host 侧的 eliKb 服务（@eli/eli/lib/kb.js）。
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'eli-kb-tools'
export const inject = ['tools']

export function apply(ctx) {
  const kb = () => ctx.get('eliKb')
  const renderText = (_meta, value) => [{ type: 'text', text: String(value) }]
  const missing = () => '知识库服务不可用（kb.js 未加载）。'

  ctx.tools.register(defineTool({
    name: 'kb_read',
    description: '读取知识库（wiki）中的一条记忆或工作流程条目。参数 entry 是条目 id（不含 .md 后缀）。',
    parameters: { entry: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: renderText },
    async execute(args) {
      const service = kb()
      if (service === undefined) return missing()
      try {
        const entry = await service.read(args.entry)
        if (entry === null) {
          return '（无此条目「' + args.entry + '」；可用 kb_search 查找，或用 kb_list 看全部条目）'
        }
        let text = entry.content
        if (entry.links && entry.links.length > 0) {
          text += '\n\n关联：' + entry.links.map((l) => '[' + l.title + '](' + l.id + ')').join('、')
        }
        if (entry.backlinks && entry.backlinks.length > 0) {
          text += '\n反向关联：' + entry.backlinks.map((l) => '[' + l.title + '](' + l.id + ')').join('、')
        }
        return text
      } catch (error) {
        return 'ERROR: ' + (error instanceof Error ? error.message : String(error))
      }
    }
  }))

  ctx.tools.register(defineTool({
    name: 'kb_search',
    description: '按关键词搜索知识库（wiki）条目，返回标题与摘要列表，供决定要 kb_read 哪一篇。',
    parameters: { query: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: renderText },
    async execute(args) {
      const service = kb()
      if (service === undefined) return missing()
      try {
        const hits = await service.search(args.query)
        if (hits.length === 0) return '（知识库中没有匹配「' + args.query + '」的条目）'
        return hits.map((hit) => '- ' + hit.id + '：' + hit.title + '\n  ' + hit.excerpt).join('\n')
      } catch (error) {
        return 'ERROR: ' + (error instanceof Error ? error.message : String(error))
      }
    }
  }))

  ctx.tools.register(defineTool({
    name: 'kb_write',
    description: '写入或更新知识库（wiki）条目。id 为小写字母数字连字符（缺省由标题生成）；title 为标题；content 为正文。写入后自动重建目录页。',
    parameters: {
      id: { type: 'string' },
      title: { type: 'string', required: true },
      content: { type: 'string', required: true }
    },
    output: { schema: { type: 'string' }, render: renderText },
    async execute(args) {
      const service = kb()
      if (service === undefined) return missing()
      try {
        const id = await service.write(args.id, args.title, args.content)
        return '已写入知识库：' + id
      } catch (error) {
        return 'ERROR: ' + (error instanceof Error ? error.message : String(error))
      }
    }
  }))

  ctx.tools.register(defineTool({
    name: 'kb_list',
    description: '列出知识库（wiki）全部条目的 id 与标题。',
    parameters: {},
    output: { schema: { type: 'string' }, render: renderText },
    async execute() {
      const service = kb()
      if (service === undefined) return missing()
      try {
        const entries = await service.list()
        if (entries.length === 0) return '（知识库为空）'
        return entries.map((entry) => '- ' + entry.id + '：' + entry.title).join('\n')
      } catch (error) {
        return 'ERROR: ' + (error instanceof Error ? error.message : String(error))
      }
    }
  }))
}

// 上下文压缩摘要器（preset 平面）。
// 继承 BasicCompactionEngine，只覆盖 summarize()：压缩指令换成中文 + 「用户偏好与人际关系」小节，
// 其余（阈值 0.8 / 保留 0.16 / 摘要上限 8192、自动触发、溢出恢复、工具结果修剪）全部沿用原生。
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { BlockAssembler, contentHasImage, createUserMessage } from '@deepseek-ai/dsh-llm'

const SUMMARY_OPEN_TAG = '<compacted-summary>'
const SUMMARY_CLOSE_TAG = '</compacted-summary>'

const ELI_COMPACTION_INSTRUCTION = [
  '你现在是上下文压缩引擎。把上面的对话压缩成一份结构化检查点，让另一个模型无需丢失任何关键上下文即可继续工作。',
  '',
  '严格按下面的 Markdown 结构输出：顺序保留所有小节；用简洁要点而非段落；空小节写「(无)」，绝不删节。',
  '',
  '## 主要请求与意图',
  '- [用户的原始与演变目标；措辞重要处逐字引用]',
  '',
  '## 关键技术概念',
  '- [涉及的技术、框架、模式与约定]',
  '',
  '## 涉及文件与代码',
  '- [确切路径：为何重要、关键改动或片段]',
  '',
  '## 错误与修复',
  '- [错误：如何解决，以及相关的用户反馈]',
  '',
  '## 未完成任务',
  '- [明确要求但尚未完成的工作]',
  '',
  '## 当前工作',
  '- [检查点时刻正在进行的精确工作]',
  '',
  '## 下一步',
  '- [与最近一次请求直接对齐的单一下一步动作，或「(无)」]',
  '',
  '## 关键上下文',
  '- [决策及其理由、约束、用户偏好、未决问题、继续所需的数据]',
  '',
  '## 用户偏好与人际关系',
  '- [用户的偏好、习惯、纠正与关系性细节；新信息合并进本小节，过时信息丢弃]',
  '',
  '规则：',
  '- 用简洁的中文工程语言书写。保留确切的文件路径、命令、错误串、标识符、数值、函数签名与语法片段。',
  '- 忠实记录用户的反馈与明确指令，尤其是纠正。',
  '- 不要提及本次压缩请求，也不要提及上下文已被压缩。',
  '- 只输出检查点文本：不要调用任何工具或采取其他动作。',
  '- 若对话已包含 ' + SUMMARY_OPEN_TAG + ' 块，说明存在先前检查点：不要逐字复制，保留仍成立的事实、丢弃过时的，并把新信息合并进同一结构。'
].join('\n')

export class EliCompactionEngine extends BasicCompactionEngine {
  async summarize(input, agent, signal) {
    const config = this.config
    const latest = agent.session.requestHeader()?.config
    const configured = config.summarizationProvider.length === 0 ? undefined : {
      provider: config.summarizationProvider,
      model: config.summarizationModel
    }
    const agentTarget = agent.options.provider !== undefined && agent.options.provider.length > 0 && agent.options.model !== undefined && agent.options.model.length > 0
      ? { provider: agent.options.provider, model: agent.options.model }
      : undefined
    const target = configured ?? latest ?? agentTarget
    if (target === undefined) {
      throw new Error('no provider/model available for summarization: set both BasicCompactionConfig summarization fields, route one request, or set both AgentOptions fields')
    }

    const assembler = new BlockAssembler()
    const messages = [...input.messages, createUserMessage({
      content: [{ type: 'text', text: ELI_COMPACTION_INSTRUCTION }],
      source: { kind: 'plugin', plugin: 'eli-compaction' }
    })]
    const options = {
      provider: target.provider,
      model: target.model,
      messages,
      ...(input.system === undefined ? {} : { system: input.system }),
      ...(input.tools === undefined ? {} : { tools: [...input.tools] }),
      maxTokens: config.maxTokens,
      sessionId: agent.session.id,
      purpose: 'compaction',
      ...(signal === undefined ? {} : { signal })
    }
    for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk)

    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new Error(finish.failure ? finish.failure.message : 'summarization ' + finish.kind)
    }
    if (finish.kind === 'max-tokens') {
      const error = new Error('summarization truncated at the token cap (incomplete checkpoint)')
      error.code = 'MAX_TOKENS'
      throw error
    }

    const rawOutput = assembler.blocks()
    if (contentHasImage(rawOutput)) {
      const error = new Error('compaction summary cannot contain image output')
      error.code = 'UNSUPPORTED_CONTENT'
      throw error
    }
    const summary = rawOutput.filter((block) => block.type === 'text')
    if (!summary.some((block) => block.text.trim().length > 0)) {
      throw new Error('summarization produced no text summary content')
    }
    return {
      summary,
      rawOutput,
      llmStreamCall: true,
      provider: options.provider,
      model: options.model,
      maxTokens: config.maxTokens,
      ...(assembler.usage === undefined ? {} : { usage: assembler.usage })
    }
  }
}

export default EliCompactionEngine

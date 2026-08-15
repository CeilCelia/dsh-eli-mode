# 设置页表单白名单（WEB_SETTINGS_NAMESPACES）

DSH 官方设置页（插件-插件配置）只把**硬编码命名空间白名单**暴露给浏览器，第三方命名空间
不在白名单内会返回 `settings-not-exposed`，此时 eli-mode 管理卡片显示「未向设置页暴露」提示。

这不影响：预设、知识库、agent 侧读取（都是直读 `~/.dsh/settings.yaml`）。只有「设置页表单」
这一层需要放行。

## 方案 A：补充白名单（推荐，表单可用）

编辑 `dsh-host-apiproxy` 包的 `WEB_SETTINGS_NAMESPACES` 常量，加入 `"eli-mode"`：

- 文件：`<dsh 安装目录>/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`
  （同一包的 `lib/types/api-proxy.js` 同步改；两处为同一内容的硬链接时改一处即可）
- 在数组末尾加一行：`"eli-mode",`
- 重启 `dsh web`

> 该常量是写死在包里的，**升级 dsh 后会被冲掉**，需要重打补丁。
> 也可用 `dsh plugin --profile web remove @deepseek-ai/dsh-host-apiproxy` 后重装
> （不推荐，会丢失补丁）。建议把补丁记进自己的维护文档。

## 方案 B：不补白名单，直接编辑 settings.yaml

管理卡片会显示兜底文案，但配置照样生效：

```yaml
eli-mode:
  personaPrompt: |
    你的人格 prompt（多行）
  kbIndexPrompt: |
    知识库目录如下，用 kb_read / kb_search 按需取用：

    {{tree}}
  kbIndex: true
```

agent 侧（预设）在每次会话组装时直读该文件，无需重启即可对新会话生效。

## 为什么是写死的？

`dsh-host-apiproxy` 的注释明确说：把该声明移到 `settings.register()`（让插件自行暴露）是
「deferred work」。在官方放开之前，第三方命名空间的设置页表单都需要这个手动白名单。

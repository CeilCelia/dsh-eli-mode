# 使用指南

本知识库（wiki）是智能体的长期记忆与工作参考。所有条目均为 Markdown 文件，存放在 `~/.dsh/eli-knowledge/wiki/` 下。

## 如何工作

- **会话只注入目录页**（`index.md` 的树形清单），细节在需要时用 `kb_read` / `kb_search` 按需取用，避免一次性灌入全部内容。
- **双链**：正文中用 `[[条目id]]` 引用其他条目，保存时自动建立正/反向链接。
- **条目 id**：小写路径（如 `research/xxx`、`projects/yyy`），不含 `.md` 后缀。

## 建议结构

```
wiki/
├── index.md            # 自动生成的全局目录（无需手写）
├── getting-started.md  # 本文件
├── projects/           # 项目笔记
├── research/           # 研究资料
└── reference/          # 常用参考
```

## 常用操作

- `kb_search 关键词`：定位相关条目
- `kb_read 条目id`：读取全文
- `kb_write 标题 + 内容`：新建/更新条目
- `kb_list`：列出全部条目

网页端：浏览器打开 `http://<dsh服务地址>/eli-kb` 即可浏览、编辑、搜索。

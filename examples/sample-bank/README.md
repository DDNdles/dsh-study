# 自建题库示例模板（`sample-bank`）

本目录是符合 `USTC-Question-Bank` v1.0 协议的**最小可导入题库模板**，内含 1 门原创示例课程（`DEMO101`，含单选、填空、解答各 1 题），可直接用于离线体验或复制改造成自己的私有题库。

## 目录结构

```text
sample-bank/
├── manifest.json                 # 题库总索引与 SHA-256 校验值
├── refresh-manifest.mjs          # 零依赖脚本：改题后一键刷新统计与 SHA-256
└── courses/
    └── DEMO101/                  # 课程代码目录（可复制新增多门课程）
        ├── meta.json             # 课程名称、简介与统计
        ├── taxonomy.json         # 知识点层次树（支持多级 parent_id）
        └── questions.jsonl       # 每行一道题（Markdown + LaTeX）
```

## 快速导入到 `dsh-study`

1. 打开 DSH 左侧 **「学习」 → 「题库管理」**。
2. 点击 **「添加题库源」**，来源方式选择 **「本地目录」**，路径填写本目录的绝对路径。
3. 勾选 `高等数学入门（示例）` 并点击同步，即可在「快速出卷」和「题库与错题」中直接使用。

## 改成你自己的题库

1. 复制 `courses/DEMO101/` 并改名为你的课程代码（例如 `PHYS101`），同步修改 `meta.json`、`taxonomy.json` 与 `questions.jsonl` 中的 `course_code` 与题目 `id` 前缀（格式：`<课程代码>-<唯一后缀>`）。
2. 按每行一条 JSON 编辑 `questions.jsonl`（字段规范见插件 `schemas/question.schema.json`）。
3. 在本目录运行：
   ```bash
   node refresh-manifest.mjs
   ```
   脚本会自动统计题量、难度、年份并回写 `meta.json` 和 `manifest.json` 的 SHA-256 校验值。
4. 回到 DSH「题库管理」点击刷新/同步即可生效；也可以将整个目录推送到 GitHub 仓库，用「GitHub 仓库」方式分享给他人。

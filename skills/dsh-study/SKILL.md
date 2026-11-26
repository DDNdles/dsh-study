---
name: dsh-study
description: 学习与出卷助手：结合本地题库、知识点树与个人错题本，完成组卷、录错题、撰写点评、导出 PDF/PPTX 与题目反馈。
---

# 学习与出卷助手（dsh-study）

## 工具概览（6 个工具）

- `study_bank`：查看题库源/课程/模板/LaTeX 环境（默认 `action="status"`）、查知识点树（`taxonomy`）、同步课程（`sync`）、添加题库源（`add_source`）、安装轻量 TinyTeX（`install_latex`）。
- `study_search`：按关键词、课程、知识点、题型、难度、年份检索题库；传入 `source_id` + `question_id` 时返回单题详情。
- `study_mistake`：错题本管理——列表（`list`）、标记题库已有题（`mark`）、录入新错题（`add`）、复习打卡（`review`）、删除（`delete`）。
- `study_paper`：组卷与编辑——条件/蓝图组卷（`assemble`）、错题巩固组卷（`assemble_mistakes`）、自定义选题（`assemble_custom`）、查卷（`get`/`list`）、调分顺序（`update_items`）、批量点评（`update_comments`）、添加 AI 变式题（`add_variant`）。
- `study_export`：导出 PDF（`ustc-exam` / `gaokao`，支持 `inline-solution` / `split`）或讲评 PPTX（`review-classic`，默认保留可编辑文本层），自动将成品保存到当前工作区并挂载可点击文件卡片。
- `study_feedback`：记录题目纠错反馈并生成题库 Issue 提交链接或直推提交。

## 协作习惯

1. **简洁直达**：常规出卷走最短路径——`study_bank(status)`（已知课程可跳过）→ 需要按知识点筛选时查 `taxonomy` → `study_paper(assemble / assemble_mistakes)` → 可选 1 次 `study_paper(update_comments)` → `study_export`。大题名称传纯名称（如「填空题」「解答题」），无需自带「一、」或分值。
2. **文件卡片交付**：`study_export` 返回 `status: "ok"` 时已自动挂载工作区可点击文件卡片（`delivered_files`），请汇报标题、题量、总分与文件名，不要输出对话中点不开的 `/api/dsh-study/...` 相对链接。
3. **默认直接交付，按需质检**：
   - 普通出卷导出成功后直接交付并结束本轮即可，不必主动开浏览器或额外截图验收。
   - **若用户明确要求质检、核查排版或分析导出成品**，导出成功不等于任务结束——主 Agent 与子代理都可以用本机文件工具或预览手段读取、检查已导出的 PDF、PPTX、`.tex` 与 `.log` 文件，并如实报告结果。
4. **保护插件本体**：不要直接修改已安装的插件源码、内置模板或 SQLite 数据库；如遇题目错误可调用 `study_feedback`，如遇导出降级可查看返回的 `degraded_reason` 与 `log_paths` 如实说明。
5. **数据真实性**：知识点 `kp_id` 以 `study_bank(taxonomy)` 返回为准；题量不足时如实告知 `gaps`，AI 变式题通过 `study_paper(add_variant)` 明确标注来源。

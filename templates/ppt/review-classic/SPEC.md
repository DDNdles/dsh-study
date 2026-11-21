# dsh-study PPT 讲评模板规范（review-classic.spec.md）

> 适用范围：`dsh-study` 内置 PPTX 讲评模板 `review-classic`（纯 Node 渲染，基于 `pptxgenjs` + `mathjax-full` SVG→PNG，零 Python 依赖）。
> 扩展机制：支持用户在 `<dataDir>/templates/ppt/<template_id>/` 通过 `template.json` 注册新主题/母版模板。

---

## 1. 画布与视觉体系

| 参数 | 规格 |
| --- | --- |
| 画布比例 | 16:9 宽屏，`13.333 × 7.5 in`（对应 `LAYOUT_WIDE`），版式坐标按 `1280 × 720 px`（96 px/in）描述 |
| 底色与底纹 | 暖白素纸 `#FAF9F5`；内页叠加全幅素雅流线型纹理底图 `assets/bg-content.jpg` |
| 正文区 | `x = 56 px`，宽 `1136 px`，起始 `y = 124 px`，最大高度 `545 px`（无页脚杂字与右下角装饰） |
| 主强调色（封面 / 作答页） | `#1F5FC9` |
| 解析色（解析页轨道、【答案】【详解】） | `#B45309` |
| 正文 / 辅助 / 轨道未完成色 | `#15181E` / `#2B2F36` / `#6B6F76` / `#B9B6AC` |
| 字体族 | 标题与编号采用 `Space Grotesk`（英文与数字）+ `Noto Sans SC` / `DengXian`（中文），与 `USTC-Question-Bank` README 标题视觉一致 |

视觉语言：延续 `USTC-Question-Bank` README 的编排美学——封面保留右侧扁平纯色多边形与细线节点、去除冗余副标题与日期，标题下方以流线型起笔轨衔接内页；内页采用全幅素雅纸面流线底图、极简扁平几何图标（`icon-question.png` / `icon-solution.png`）、无框 `Space Grotesk` 编号与流线型题目进度轨道（已完成实线实点、当前双环节点、未完成虚线空心圆），无右下角图案、无底部小字。

- **封面**：左侧极简图标 + 模式标签 + 标题（最多 3 行）+ 流线型起笔轨；右侧扁平多边形群与细线节点。
- **内容页**：顶部极简图标 + `01`/`02` 编号 + 竖线 + 题型标题 + 右对齐出处，下方贯通整页的流线型进度轨道；正文下方完全留白供板书与阅读。

---

## 2. 幻灯片结构（1 张封面 + 每题双页）

### 2.1 封面页（Slide 1）
- **主标题**：试卷标题（如 `《数学分析B1》错题讲评` / `期中模拟试卷讲评`），居中加粗 `36 pt`，`#1D4ED8`。
- **副标题元信息条**：`课程：<course>　|　模式：<mistake/exam/topic>　|　<YYYY-MM-DD>　|　共 N 题（总分 M 分）`，`16 pt`，`#6B7280`。
- **可选目录/知识点覆盖摘要**：列出本卷覆盖的前 5 个知识点与题目分布（来自 `taxonomy.json`）。

### 2.2 每题第 1 页：作答页（板书/展示用）
1. **顶部元信息栏**（`x=0.4, y=0.15, w=12.533, h=0.45 in`）：
   - 文本：`第 {seq} 题（{score} 分）· {题型中文名}　|　{source.ref 截断至 40 字}`，`13 pt`，`#6B7280`。
   - 若为错题原题重做或 AI 变式，右侧附小徽章文字（`错题重做` / `AI 变式`）。
2. **题干区**（`x=0.4, y=0.65, maxW=12.533, maxH=4.3 in`）：
   - Markdown + LaTeX 题干通过 MathJax 渲染公式并与中文混排（纯文字/简单公式直接原生可编辑文本框；含分式/积分/矩阵等复杂 LaTeX 块经 `mathjax-full` 转高清 200 DPI PNG 等比嵌入，保持清晰可读）。
   - 若 `stem.figures` 非空，右侧/下方等比嵌入题目配图。
3. **选项区（仅 `single` / `multi` 题型）**（紧接题干下方 `gap=0.12 in`，最大高度 `1.2 in`）：
   - 4 个选项横向 2×2 或 1×4 自适应排布，`A. ...  B. ...  C. ...  D. ...`。
4. **页脚**：默认留空作板书区；仅当 `answer.origin === "ai"` 或 `is_ai_variant === true` 时显示 `本题含 AI 推导或变式，讲评时请核验`，`#B45309`。

### 2.3 每题第 2 页：解析页（讲评对照用）
1. **顶部蓝色标题栏**（`x=0.4, y=0.15, w=12.533, h=0.5 in`）：
   - 文本：`第 {seq} 题·解析（{题型中文名}｜{source.ref 截断至 32 字}）`，`16 pt`，加粗，`#1D4ED8`。
2. **上方题干回顾缩略区**（`x=0.4, y=0.7, maxW=12.533, maxH=2.2 in`）：
   - 复用或缩放本题目题干，避免讲评时来回切页。
3. **下方解析区**（紧接题干下方至 `y=7.1 in`，自动换行，内容超长时自动拆分页或缩小字号至不低于 `13 pt`）：
   - **`【答案】`**（橙色加粗 `#B45309`）+ `answer.md`（附来源标牌：`官方标答` / `社区详解` / `AI 推导`）。
   - **`【详解】`**（橙色加粗）：优先逐条渲染 `solution.steps[]`（最多 8 步，步数过多自动续页）；若 `steps` 为空则渲染 `solution.md`。
   - **`【点评与易错】`**（橙色加粗，可选）：展示错题本中用户记录的错因标签/反思笔记，或题目的 `quality.note`。
4. **演讲者备注（Speaker Notes）**：
   - 写入完整 `source.ref`、`tags.kp_ids`、难度星级、答案来源 `answer.origin_detail` 与完整 `solution.md` 原文，便于讲者参考。

---

## 3. 前端大纲与逐页预览契约

`dsh-study` 导出 PPTX 时同步输出一份轻量的 `slides-manifest.json`（每页标题、页型 `cover|question|solution`、对应 `question_id`、渲染的公式/页缩略图路径），供 Client 工作台「导出与预览」标签页直接浏览逐页大纲与卡片预览，并提供一键下载 `.pptx` 与打开所在文件夹。

---

## 4. 自定义 PPT 模板清单契约

用户可在 `<dataDir>/templates/ppt/<template_id>/template.json` 注册自定义配色、字体与母版配置：

```json
{
  "id": "review-dark",
  "kind": "ppt",
  "name": "深色讲评模板",
  "description": "高对比度深色背景，适合投影与夜间屏幕讲评",
  "engine": "pptxgenjs",
  "theme": {
    "background": "#0F172A",
    "text": "#F8FAFC",
    "accent": "#60A5FA",
    "highlight": "#F59E0B",
    "muted": "#94A3B8"
  }
}
```

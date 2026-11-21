# dsh-study PDF 模板规范（pdf-templates.spec.md）

> 适用范围：`dsh-study` 可插拔 PDF 模板注册表与 `xelatex` / KaTeX 渲染管线。
> 原则：内置 **2 套核心考试卷模板**（`ustc-exam` 默认、`gaokao` 保留），**不包含必刷题（`bsq`）与 `bishua` 模板**；支持用户在 `<dataDir>/templates/pdf/<id>/` 扩展任意新模板。

---

## 1. 统一导出模式（所有 PDF 模板必须支持）

用户导出 PDF 时必须在以下两种版式模式之间选择（可另附 `question-only` 快捷选项）：

| 模式枚举 | 中文名称 | 产出行为 | 适用场景 |
| --- | --- | --- | --- |
| `inline-solution` | **解析版（题目后解析）** | 单份 PDF：每道题/小题下方紧跟参考答案、详解步骤与点评/易错提示（与 `2024数学分析B1期末考试参考答案.pdf` 形态一致） | 错题复盘讲义、期末复习资料、习题课参考答案 |
| `split` | **原题 + 答案分开版** | 产出**原题卷**（隐藏解析、保留卷头/得分表/装订线/作答留白）与**独立答案卷**（卷头标「参考答案与解析」，按原题号对应输出答案、解析与点评）。通过 `splitLayout: "two-files" \| "combined"` 控制输出为两份独立 PDF（默认 `paper.pdf` + `answers.pdf`）还是单文件分页合订 | 闭卷模拟自测、打印做题后核对答案 |

---

## 2. 内置模板 A：`ustc-exam`（默认 · 中科大大学标准考试卷）

- **视觉与结构基准**：`theme-samples/ustc-exam/{p1_cover_and_limit,p2_even_integrals,p5_proof_and_comment}.png`（取自 `2024数学分析B1期末考试参考答案.pdf` 第 1、2、5 页）与同目录基准源码 [`template_ustc_exam.tex`](template_ustc_exam.tex)。
- **文档类与引擎**：`\documentclass[a4paper,11pt]{ctexart}` + `xelatex`（编译 2 遍解析 `LastPage`）。
- **核心版式要素**：
  1. **纸张与版心**：默认 A4 纵向单栏（可选 Letter `612×792pt` 兼容原件），左 `30mm`（含装订区）、右 `22mm`、上 `24mm`、下 `22mm`。
  2. **奇数页密封装订线**（`showBindingLine` 布尔开关，默认原题卷/解析版开启、独立答案卷关闭）：
     - 仅在奇数页（第 1、3、5… 页）左侧距纸边 `19mm` 处绘制垂直虚线 + 4 个白色实心圆圈 `○`。
     - 线左竖排（逆时针 90°）：`学生所在院系：______　姓名：______　学号：______`。
     - 线右竖排（逆时针 90°）：`装订线　答题时不要超过此线`。
  3. **首页居中卷头**：
     - 粗黑体校名与学年学期（如 `中国科学技术大学2024--2025学年第一学期`）。
     - 粗黑体课程名与考试性质（如 `《数学分析B1》期末考试试卷(A卷)`；独立答案卷自动追加 `——参考答案与解析`）。
     - 宋体下划线元信息行：`考试时间 ______　　考试形式 ______`。
  4. **动态得分表**：3 行标准全框线表格（`题号` / `满分` / `得分`），列头按大题数自动生成中文序号 `一 | 二 | … | 总分`，分值自动求和；独立答案卷模式下自动隐藏。
  5. **大题与小题结构**：
     - 大题：`一. (16分, 每小题8分) 求极限:` 或单题大题 `三. (10分) ...`。
     - 小题：`(1)`、`(2)` 缩进枚举；遇到 `single`/`multi` 选择题时自动渲染 `A. B. C. D.` 选项行，遇到 `blank` 填空题自动补下划线占位。
  6. **解答与红色点评块**：
     - 解答引导词：加粗黑体 **`解`**（计算/解答/选择/填空题）或 **`证明`**（`type === "proof"` 证明题），紧接空一格正文，不加冒号。
     - 红色点评块（`#C01C28`）：以加粗 **`点评：`** 开头，用于渲染知识点标签摘要、错题反思笔记、一题多解提示或 AI 变式声明（`answer.origin === "ai"` 或 `is_ai_variant === true` 时必须显式提示）。
  7. **居中灰色页脚**：`#666666`，格式 `{term}　第 X 页（共 Y 页）`。
  8. **分开版留白策略**：原题卷模式下，按题型自动给 `solve`/`proof` 预留书写空间（默认 5–7 cm，可在导出选项中调紧凑/标准/宽松三档）。

---

## 3. 内置模板 B：`gaokao`（保留 · 高考标准考试卷）

- **视觉与结构基准**：`theme-samples/gaokao/{ref_2021_p1,ref_2025_p1,ref_2025_p2}.png` 与同目录基准源码 [`template_Math_exam.tex`](template_Math_exam.tex)。
- **文档类与引擎**：`\documentclass{exam-zh}` + `xelatex`。
- **核心版式要素**：
  1. **纸张与数学样式**：A4 纵向，`\everymath{\displaystyle}`。
  2. **卷头**：`\secret`（绝密★启用前）+ `\title{卷名}\subject{学科}\maketitle` + `notice` 注意事项环境（可配置隐藏或替换为自定义考试须知）。
  3. **大题与连续编号**：按题型分 `\section{...}`（单选 / 多选 / 填空 / 解答与证明）并附赋分说明；全卷采用连续阿拉伯编号 `1.` 起（非首大题使用 `\begin{enumerate}[label=\arabic*., start=N]` 续接）。
  4. **选项与答案**：`choices` 环境，标签为 `A. B. C. D.`（不带括号）；选择题干尾在原题卷用 `\paren` 空括号，解析版填 `\paren[字母]`（若题干源文本已带空括号则替换避免双括号）。
  5. **双导出模式映射**：
     - `inline-solution`：`examsetup` 设 `paren/show-answer=true`、`solution/show-solution=show-stay`，每题后直接展示答案、详解与点评/出处。
     - `split`：原题卷设 `paren/show-answer=false`、`solution/show-solution=hide`；独立答案卷按题号顺序渲染参考答案与详解步骤（不含重复题干或可配置精简题干）。
  6. **赋分**：题量匹配 19 题制（8 单选 + 3 多选 + 3 填空 + 5 解答）时可选启用标准 150 分制（5/6/5/13·15·15·17·17）；其余任意题量均按试卷草稿 `paper.json` 的分值渲染。

---

## 4. 共用 LaTeX 消毒与降级规则

1. **输入数据消毒（渲染前统一执行）**：
   - 题库字段来自 `USTC-Question-Bank` v1.0（Markdown + LaTeX），消毒器须在**数学定界符之外**转义 `_`、`#`、`%`、`&`，避免破坏 `$...$` / `$$...$$` / `\begin{align*}...\end{align*}`。
   - 将 Markdown `**粗体**`、`*斜体*` 转为 `\textbf{}` / `\emph{}`，Markdown 管道表格转为带框 `tabular`（宽表自动 `\resizebox{\linewidth}{!}`）。
   - 数学环境内的中文或全角标点统一包 `\text{...}`，防止数学字体缺字出现豆腐块。
   - 配图（`stem.figures` / `answer.figures` / `solution.figures` / `options[].figures`）解析到本地缓存绝对路径后用 `\includegraphics[max width=0.85\linewidth]{...}` 插入（SVG 必要时先转 PNG/PDF）。
   - 题目来源与 AI 声明：凡 `answer.origin === "ai"` 或 `is_ai_variant === true`，在解析/点评区域显式标注 `AI 推导/变式（请核验）`。
2. **编译韧性与无 TeX 降级**：
   - Host 通过 `ctx.subprocess` 调用配置的 `xelatex` 编译（受超时保护，运行 2 遍稳定页码）。
   - 若某道题触发 LaTeX 语法错误，按 `.log` 行号定位单题块降级为安全纯文本块重试（最多 2 轮），避免整卷编译崩溃。
   - **无论 `xelatex` 是否存在**，均输出对应的 `.tex` 源码与一份独立**可打印 KaTeX HTML**（复刻同一套版头、得分表与 `inline-solution` / `split` 模式），供无 TeX 环境下在前端直接预览并通过浏览器打印为 PDF。

---

## 5. 可插拔自定义模板扩展协议

用户或第三方可在 `<dataDir>/templates/pdf/<template_id>/` 下新增目录，只需包含 `template.json` 与模板入口文件即可被 `dsh-study` 自动发现：

```json
{
  "id": "my-custom-exam",
  "kind": "pdf",
  "name": "自定义期中卷模板",
  "description": "支持题目后解析与分开版导出",
  "engine": "xelatex",
  "entry": "./template.tex.hbs",
  "supportsModes": ["inline-solution", "split"],
  "defaultOptions": {
    "schoolTerm": "中国科学技术大学 2026-2027学年第一学期",
    "showBindingLine": true,
    "showComment": true,
    "splitLayout": "two-files"
  }
}
```

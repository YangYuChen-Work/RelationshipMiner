# 自然语言分析表与字段选择设计

**日期：** 2026-08-05  
**状态：** 已修订，待用户审阅

## 1. 目标、边界与既有契约

用户用自然语言描述希望探索的业务对象和关系，系统自动生成可编辑的“分析表 + 辅助字段”初始选择。自然语言模式是默认入口；原有手动选表、搜索、字段加载与字段勾选完整保留，并可随时切换。

本期只生成分析表与辅助字段，**不生成行级过滤条件**，也不改变图谱、WebSocket 进度或关系分析语义。为检测 schema 漂移，`/api/analyze` 可向后兼容地增加可选 `metadata_revision`；既有手动调用方可省略它。界面提示语为：“请描述要分析的业务对象，以及希望探索的关系。例如：分析客户、订单与退款之间的关系。”时间表述若出现，只用于帮助识别相关表或日期类辅助字段；界面需明确说明当前版本不会据此筛选数据行。

两种模式只维护一份 `selectedTables`。切换模式不丢失选择；自然语言成功结果会成为候选替换方案，用户可以继续微调后才进入既有分析流程。

现有分析契约保持不变：

- `name`、`class_name` 是必需业务上下文，节点展示仍以 `name` 为准；
- 主键、外键仍是关系计算所需的隐式字段；
- AI 和前端选择的仅是 `dimensions`（即辅助字段）；若描述未明确限定辅助字段，则所选表的全部合法辅助字段默认进入 `dimensions`；
- 当前 `load_scoped_records` 已在读取阶段自动补齐必需上下文、业务代码、主键和相关外键，`/api/analyze` 继续只接收辅助字段数组；
- 没有同时满足 `name` 与 `class_name` 约定的表，不进入自然语言选择器可见目录。

术语统一使用“自然语言分析表与字段选择”，避免“数据范围”被误解为行级过滤。

## 2. 用户交互与选择状态

### 默认流程

选择工作区默认展示“自然语言选取”，包含描述输入框、“AI 自动选取”按钮、请求中状态和切换到“手动选取”的按钮。成功后按现有表卡片呈现已选表、隐式必选字段说明及可编辑的辅助字段，并展示每张表的一句普通文本理由和命中术语。

自然语言模式允许直接增加/取消表和辅助字段；手动模式继续浏览所有可用表。两种模式显示同一个 `selectedTables`，所以切换不产生配置副本。

### 防止误覆盖

首次生成且当前选择为空时，成功响应可原子写入 `selectedTables`。若当前选择已被用户手动修改，前端不得静默永久覆盖：先展示新旧表和字段的差异，用户点“应用并替换”后才写入；也可以取消并保留当前选择。

状态至少包含：

```ts
selectionMode: "natural" | "manual";
selectedTables: Map<string, SelectedTable>;
previousSelection: Map<string, SelectedTable> | null;
selectionSource: "ai" | "manual" | "mixed";
selectionDirty: boolean;
metadataRevision: string | null;
naturalLanguage: {
  input: string;
  status: "idle" | "loading" | "selected" | "needs_clarification" | "unavailable";
  activeRequestId: string | null;
};
```

每次请求生成 `requestId` 并使用 `AbortController` 取消已废弃请求。仅当响应 `requestId` 等于 `activeRequestId`、且用户尚未切换到新的选择操作时，才允许调用单一的 `applyAISelection` action。该 action 负责完整替换、去重、保存 `previousSelection`、写入版本和来源；不允许异步逐表追加而产生半完成状态。

### 用户可修正与服务不可用

`selected` 与 `needs_clarification` 使用 HTTP 200；后者不写入选择，并给出具体的 `guidance` 与可选追问。用户可修正的代码为：

- `MISSING_BUSINESS_OBJECT`
- `AMBIGUOUS_INTENT`
- `NO_RELIABLE_MATCH`
- `SCOPE_TOO_BROAD`

空白或超过长度限制的描述属于 HTTP 422 参数错误。元数据、词汇表、模型或结构化输出异常使用 HTTP 503 和 `unavailable`，并保留当前选择，避免把服务故障错误归因给用户。服务问题代码为：

- `METADATA_UNAVAILABLE`
- `GLOSSARY_INVALID`
- `MODEL_UNAVAILABLE`
- `INVALID_MODEL_OUTPUT`

`unavailable` 的提示为“当前无法完成自动选取，已有选择未发生变化；可稍后重试或切换到手动选取”，不暴露异常栈、原始模型输出或提示词。

## 3. 端到端数据流

```text
用户描述
  -> 前端校验长度、取消旧请求并记录 requestId
  -> 后端从固定数据源生成可分析表目录快照
  -> （未来鉴权接入点）按用户/租户/项目权限过滤目录
  -> 加载、验证并编译版本化业务词汇表
  -> 词汇表、受控正则与元数据产生排序和命中证据
  -> 将全部核心表摘要、合法辅助字段及证据交给单个模型
  -> 模型返回 selected 或 needs_clarification
  -> 确定性校验、生成 metadataRevision 与 glossaryVersion
  -> 前端核对 requestId，展示差异或原子应用
  -> 用户微调
  -> 提交既有 /api/analyze，轻量复核目录快照
```

当前项目没有用户、租户或项目鉴权，且数据源由后端环境配置固定。因此第一版 `CatalogSnapshotProvider` 返回当前引擎中、满足既有 `name` / `class_name` 契约的表，客户端不能通过请求参数选择数据源或注入表/字段名。该提供者必须作为唯一的模型目录来源，以便将来接入鉴权时，在模型调用**之前**注入权限过滤，而不是先泄露未授权元数据再拒绝结果。

当前仅维护 10 张核心表，模型必须看到全部目录的表级摘要；词汇表只影响排序、命中理由和模型证据，绝不作为硬过滤条件。表规模增长后再采用“命中表 + 语义 Top-K + 业务域核心表 + 明确点名表”的宽候选策略，并始终保留低召回兜底。

模型上下文只含后端白名单提供的表名、表摘要、字段名、字段角色、词汇命中与排除证据；不得传输全表记录、凭据、内部提示词、原始异常或不在可见目录中的名称。模型理由在前端只按文本节点渲染，不能作为 HTML 插入。

## 4. 后端组件与接口

新增 `POST /api/natural-language-selection`。请求只包含 `description`；数据源、表目录与字段目录均由后端确定。响应包含 `request_id`、状态、版本及安全的选择或引导信息。

```text
NaturalLanguageSelectionController
  -> NaturalLanguageSelectionService
       |- CatalogSnapshotProvider
       |- GlossaryRepository
       |- CandidateRanker
       |- SelectionModelClient
       `- SelectionValidator
```

- `CatalogSnapshotProvider`：建立可分析表、合法辅助字段和字段角色快照，并计算元数据版本；不处理 AI 或词汇匹配。
- `GlossaryRepository`：加载 YAML、校验结构、预编译受控正则并给出 `glossaryVersion`。
- `CandidateRanker`：归一化输入，产生别名、正则、排除词和元数据匹配证据及排序；不做最终选择。
- `SelectionModelClient`：封装现有 `DeepSeekJsonAdapter` 的结构化 JSON 调用、超时和提供商错误；以协议隔离具体厂商，测试可注入 Fake client。
- `SelectionValidator`：校验模型输出是否在同一目录快照内，表数上限、辅助字段选择意图、字段角色、去重与版本一致性是否满足要求。

模型输出只允许辅助字段选择意图：`field_selection` 为 `all` 或 `specified`。当用户没有明确限定辅助字段时，模型必须返回 `all`；`SelectionValidator` 根据目录快照把它展开为该表的全部合法辅助字段，并在 API 响应中返回完整的 `auxiliary_fields`，以适配既有 `selectedTables` 与 `/api/analyze`。只有用户明确点名字段或字段类别时才使用 `specified`。某张选中表允许没有合法辅助字段，此时展开为 `[]`。接收结果由 `SelectionValidator` 拒绝以下字段：`name`、`class_name`、主键、外键、未知字段、重复字段。必需字段与关系字段由现有分析读取逻辑隐式补齐，模型和前端都不负责推断或提交它们。

响应约定如下：

```json
{
  "status": "selected",
  "request_id": "uuid",
  "metadata_revision": "sha256:...",
  "glossary_version": "2026-08-05.1",
  "selector_version": "nl-selection-v1",
  "tables": [
    {
      "table_name": "sales_order",
      "field_selection": "all",
      "auxiliary_fields": ["order_status", "order_amount", "created_at"],
      "reason": "订单是所述关系的核心业务对象。",
      "matched_terms": ["订单"]
    }
  ],
  "warnings": []
}
```

`needs_clarification` 返回 `reason_code`、`guidance` 和至多两个 `suggested_questions`；`unavailable` 返回 HTTP 503、`reason_code` 与安全提示。模型自报的 0–1 `confidence` 不作为接受门槛，也不必在第一版返回。接受 `selected` 的条件是结构合法、所有表字段均在快照内、符合字段与数量预算、模型未报告关键歧义，并且每个选表具有可解释的词汇或元数据证据。

## 5. 词汇表、正则与预算

业务词汇表使用仓库内受版本控制的 YAML，建议实现路径为 `backend/config/natural_language_glossary.yaml`，初始维护 10 张核心表。规范、完整样例与维护检查清单见 [自然语言选表词汇表 YAML 指南](2026-08-05-natural-language-glossary-guide.md)。

格式采用单一的 `term_mappings` 列表：每个自然语言 `term` 具有一个或多个 `targets`，每个目标包含 `table_name`、排序 `weight`、可选 `boost_when_any` 与 `exclude_when_any`。因此“客户”可只映射 `customer`，而“订单”可同时映射销售、采购和生产订单；后者产生多条歧义证据，而不是配置错误或硬过滤。表定义单独维护业务域和可推荐辅助字段的字段级词条，避免在每个表中重复通用词。

同一表内的重复目标、引用不存在表字段、错误的 `match`/`pattern` 组合属于配置错误；不同表共享自然语言词条是合法且预期的。权重只用于排序和说明，不能单独自动选表。

正则只做归一化与受控别名匹配，绝不接收用户提供的正则。它们在启动/加载时编译，受长度和复杂度限制，并采用可设置匹配超时的实现，以避免灾难性回溯。配置错误必须使该功能进入 `GLOSSARY_INVALID`，不允许静默降级为错误选择。

唯一的自动选择上限沿用现有表上限：

```yaml
selection_limits:
  max_tables: 10
```

除非用户在描述中明确限定字段或字段类别，模型默认选择每张已选表的全部合法辅助字段，不得为了优化性能而静默截断。用户随后可在自然语言或手动模式取消不需要的字段；分析提交前继续执行既有字段和表校验。只有表数超过 10 张时返回 `SCOPE_TOO_BROAD` 或 `needs_clarification`。

## 6. 一致性、隐私与可观测性

目录快照的 `metadata_revision` 由可分析表、字段名和字段角色的稳定序列化计算；词汇表版本由文件版本或内容哈希提供。前端将版本随当前选择保存，并在自然语言结果仍为当前选择来源时，把它作为可选字段随 `/api/analyze` 提交。用户启动分析时，后端轻量复核版本以及每张表与辅助字段仍存在、仍满足角色约束；不一致时拒绝提交并提示“数据库结构已发生变化，请重新确认分析范围”，避免在分析过程中才因 schema 漂移失败。手动选择或与自然语言结果混合后的范围允许省略该版本，但仍要执行既有的实时表、字段校验。

默认不记录用户的自然语言原文。可观测性仅记录：`request_id`、耗时、状态、`reason_code`、候选与最终表数量、模型/词汇表/元数据版本、是否应用 AI 结果、是否随后手动修改或切换模式。原文仅能在显式启用、受访问控制的安全调试模式下短期记录。

本功能不需要多 Agent。单模型结构化选择、模型协议抽象和确定性校验即可满足当前 10 表范围；多 Agent 会增加成本、时延和分歧面。

## 7. 测试、语义验收与完成标准

后端单元和接口测试覆盖：目录快照与不合格表过滤、词汇 YAML/别名歧义/受控正则、候选排序、模型请求、未指定字段时展开所有合法辅助字段、明确字段时只保留指定字段、未知表字段、隐式字段误选、表数上限、模型超时、非法 JSON、元数据不可用、HTTP 状态以及不泄露记录或内部信息。

前端测试覆盖：默认自然语言模式、空值和过长校验、加载、三种返回状态、请求取消与旧响应丢弃、空选择自动写入、已编辑选择的差异确认、撤销/保留、模式切换、微调以及既有手动选择和分析提交流程。

为 10 张核心表建立版本控制的离线语义验收集（初始 60–100 条），覆盖单表、多表、同义词、简称、错别字、中英文混合、排除表达、歧义词、时间表述、超 10 表、显式表名、提示注入、SQL 风格文本、无关描述和未来无权限表场景。记录表级 Precision/Recall、完整集合准确率、辅助字段准确率、正确澄清率、错误预选率和 P95 响应时间。

以下为硬性验收条件：不存在表、无权限表（鉴权接入后）、非法字段、超预算选择以及失败时污染 `selectedTables` 的发生率均为 0。核心语料的完整表集合准确率目标为至少 90%，并在词汇表、模型或选择器版本变化时回归执行。

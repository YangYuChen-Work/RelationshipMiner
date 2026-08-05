# 自然语言选表词汇表 YAML 指南

本文件定义自然语言分析表与字段选择器使用的版本化 YAML 格式。它是开发/运维维护的配置，不提供前端编辑入口。配置只为排序、解释和候选证据服务；在当前 10 张核心表范围内，模型仍会看到全部可分析表的摘要，因此任何词条都不是硬过滤条件。

## 文件约定

- 建议路径：`backend/config/natural_language_glossary.yaml`。
- UTF-8 编码、两空格缩进；字符串中的 `:`、`#`、正则反斜杠须正确引用。
- `schema_version` 在格式不兼容时递增；`glossary_version` 在每次内容变更时递增。
- 所有 `table_name` 和 `field_name` 必须来自后端目录快照；启动时校验，错误时自然语言接口返回 `GLOSSARY_INVALID`。
- 每个自然语言词条只有一个 `term`，却可以有一个或多个 `targets`；这正是处理“订单”可指销售、采购或生产订单的规范方式。

## 完整示例

```yaml
schema_version: 1
glossary_version: "2026-08-05.1"

selection_limits:
  max_tables: 10

ranking_defaults:
  boost_when_any: 15
  exclude_penalty: 20

# 描述可分析表与允许由 AI 推荐的辅助字段；这里不重复维护通用词条。
tables:
  customer:
    domain: sales
    display_name: 客户
    auxiliary_fields:
      customer_type:
        terms: [客户类型, 客户等级, 会员等级]
      region:
        terms: [地区, 区域, 所在地]

  sales_order:
    domain: sales
    display_name: 销售订单
    auxiliary_fields:
      order_status:
        terms: [订单状态, 状态, 订单进度]
      order_amount:
        terms: [订单金额, 金额, 成交额]
      created_at:
        terms: [下单时间, 创建时间, 订单日期]

  purchase_order:
    domain: procurement
    display_name: 采购订单
    auxiliary_fields:
      purchase_status:
        terms: [采购状态, 采购进度]
      purchase_amount:
        terms: [采购金额, 采购额]

  supplier:
    domain: procurement
    display_name: 供应商
    auxiliary_fields:
      supplier_level:
        terms: [供应商等级, 供应商级别]
      delivery_score:
        terms: [履约, 交付评分, 准时交付]

# 词条统一在这里维护。每个词条可指向一个或多个表，权重只用于排序，不能直接决定选择结果。
term_mappings:
  - term: 客户
    match: literal
    targets:
      - table_name: customer
        weight: 100

  - term: 销售订单
    match: literal
    targets:
      - table_name: sales_order
        weight: 100

  - term: 供应商
    match: literal
    targets:
      - table_name: supplier
        weight: 100

  # “订单”本身有歧义：保留所有合法目标，让模型结合描述与证据决定。
  - term: 订单
    match: literal
    targets:
      - table_name: sales_order
        weight: 60
        boost_when_any: [销售, 客户, 下单, 成交]
        exclude_when_any: [采购, 供应商, 入库]
      - table_name: purchase_order
        weight: 60
        boost_when_any: [采购, 供应商, 入库]
        exclude_when_any: [销售, 客户, 下单]

  # 正则仅限开发/运维维护、加载时预编译的受控模式；不得接受用户提供的正则。
  - term: "销售订单简称"
    match: regex
    pattern: "(?:销售)?订单(?:表|数据)?"
    targets:
      - table_name: sales_order
        weight: 45
        boost_when_any: [销售, 客户]

examples:
  - input: 分析客户下单和订单金额的关系
    expected_tables: [customer, sales_order]
  - input: 看采购订单和供应商的履约情况
    expected_tables: [purchase_order, supplier]
  - input: 分析订单
    expected_status: needs_clarification
    acceptable_reason_codes: [AMBIGUOUS_INTENT]
```

`terms` 是字段级证据，不能把字段本身直接选入分析；选择器仍须验证该字段在指定表中存在、且是合法辅助字段。`examples` 同时是维护提示和离线语义验收集的种子数据。

当用户描述没有点名字段或字段类别时，选择器会对每张最终选中表展开全部合法辅助字段（即非 `name`、非 `class_name`、非主键、非外键字段）。词汇表中的字段 `terms` 仅帮助识别用户**明确**限定的字段；它们不改变“未明确限定即全选”的默认规则。

## 解析与排序规则

1. 对用户描述做 Unicode 归一化、大小写和分隔符归一化。
2. 对每个 `term_mappings` 条目匹配一次；字面量匹配与正则匹配均产生命中证据。
3. 对条目内每个 `targets` 独立累加基础 `weight`；`boost_when_any` 命中时加上 `ranking_defaults.boost_when_any`，`exclude_when_any` 命中时减去 `ranking_defaults.exclude_penalty` 或标记为冲突，不能从模型目录中删除该表。
4. 同一词条命中多个表时，保留每个目标、各自证据和排序分数；不把它视为 YAML 错误，也不在词汇表层擅自裁决。
5. 同表同字段、同一词条的重复目标是配置错误；不同表共享词条是合法配置。
6. 模型接收当前全部核心表的摘要、合法辅助字段和上述证据，输出由后端 `SelectionValidator` 最终校验；未指定字段范围时，校验器展开该表的所有合法辅助字段，不作字段数量截断。

权重只定义相对优先级，禁止作为“高于某阈值即自动选中”的规则。若模型无法消解歧义，则返回 `needs_clarification`；例如“请说明是销售订单、采购订单还是生产订单”。

`weight`、`boost_when_any` 与 `exclude_penalty` 必须是非负整数，且 `weight` 为 1–100；空列表、重复目标和重复字段词条在加载时拒绝。这样每个 YAML 文件都能被确定性校验，避免“隐式默认值”造成不同环境的排序不一致。

## 正则安全规则

- `match: regex` 时必须提供 `pattern`，`match: literal` 时不得提供 `pattern`；
- 限制模式长度和嵌套量词；加载时编译并拒绝失败配置；
- 使用支持匹配超时或线性时间保证的实现；单条匹配必须有超时上限；
- 禁止动态从用户输入、HTTP 参数或数据库记录加载正则；
- 正则和普通词条一样仅产生证据，不能绕过表、字段、权限或数量校验。

## 维护检查清单

- 新增表时，先确认它符合既有 `name` 与 `class_name` 分析契约；
- 为新表添加专有词、可共享的歧义词及至少一个示例语句；
- 只在用户确实会使用的别名上增加正则，优先使用字面量；
- 运行 YAML 校验、词汇表单元测试及离线语义验收集；
- 更新 `glossary_version`，并在变更说明中记录词条目的与影响表。

# 自然语言选表 YAML 词汇表指南（第一版）

第一版词汇表只解决“用户常说的词对应哪些表”。配置由开发/运维在仓库中维护，建议实现路径为 `backend/config/natural_language_glossary.yaml`。它只为表级命中证据服务：当前 10 张核心表的摘要仍会完整提供给模型，词汇表不会硬过滤任何可分析表。

辅助字段不在 YAML 中配置。自然语言未明确指定字段时，选择器为最终表勾选全部合法辅助字段；用户明确限定字段时，模型依据后端提供的字段元数据选择具体字段。

## 格式

```yaml
schema_version: 1
glossary_version: "2026-08-05.1"

mappings:
  - aliases:
      - 需求
      - 需求表
      - 需求数据
      - 产品需求
      - 客户需求
    tables:
      - requirement

  # 一个映射组可对应多个表；“工艺”命中时，所有表都会作为歧义证据传给模型。
  - aliases:
      - 工艺
      - 工艺表
      - 工艺数据
    tables:
      - process_route
      - process_step
      - process_parameter

  - aliases:
      - 工艺路线
      - 工艺路线表
      - 加工路线
    tables:
      - process_route

  - aliases:
      - 工序
      - 工序表
      - 加工步骤
      - 工艺步骤
    tables:
      - process_step

  - aliases:
      - 工艺参数
      - 工艺参数表
      - 加工参数
    tables:
      - process_parameter

  - aliases:
      - 客户
      - 客户表
      - 客户数据
    tables:
      - customer

  # “订单”可能指多个业务表，因此在同一个 mappings 项中列出全部合法目标。
  - aliases:
      - 订单
      - 订单表
      - 订单数据
    tables:
      - sales_order
      - purchase_order

  - aliases:
      - 销售订单
      - 销售订单表
      - 客户订单
    tables:
      - sales_order

  - aliases:
      - 采购订单
      - 采购订单表
      - 供应商订单
    tables:
      - purchase_order
```

## 解析与使用规则

1. 加载时对别名进行 Unicode NFKC、大小写和空白归一化；运行时对用户描述执行同样的归一化后做字面量匹配。
2. 命中任一 `aliases`，就为该项的每张 `tables` 产生相同的命中证据；一项有多张表是合法的歧义映射，不由 YAML 自行裁决。
3. 多个映射项命中同一张表时，累积证据；模型结合用户完整描述、全部核心表摘要与字段元数据做最终选择。
4. YAML 未命中时，模型仍可从完整核心表目录选择；这保证词汇表只是可维护的增强，而不是遗漏表的单点故障。
5. 表名必须来自后端生成的可分析表目录；不能由前端传入、也不能直接拼接到 SQL。

例如，“查看工艺路线和工序的关系”会为 `process_route` 与 `process_step` 产生多条证据；“分析订单”同时为 `sales_order` 与 `purchase_order` 产生歧义证据。如果模型无法依据描述消解歧义，应返回 `needs_clarification`，提示用户说明销售、采购或其他订单类型。

## 校验规则

- `schema_version` 必须为整数 `1`；格式不兼容时递增；
- `glossary_version` 必须为非空版本字符串，并在内容变化时更新；
- `mappings` 必须是非空列表；每一项的 `aliases` 与 `tables` 都必须是非空列表；
- 映射项内的别名和表名去重后不得为空；空字符串、非字符串、重复值或未知表名都是 `GLOSSARY_INVALID`；
- 同一个归一化后的别名不应分散在多个映射项中。若它要对应多个表，应合并到同一项的 `tables`，避免重复扫描与隐式冲突；
- 首版仅支持字面量别名，不支持 YAML 正则、权重、字段词条、排除词或前端编辑；这些能力只在有真实维护需求时以新的 `schema_version` 设计。

## 维护示例

要把“工艺卡”也映射到三类工艺表，只需把它加入“工艺”映射项：

```yaml
  - aliases:
      - 工艺
      - 工艺表
      - 工艺数据
      - 工艺卡
    tables:
      - process_route
      - process_step
      - process_parameter
```

不要复制一份包含“工艺卡”的新映射项；同义词集中在同一项、多个目标表集中在同一个 `tables` 列表，维护和加载都会更高效、也更容易审查。

"""Deterministic SQLite business records for semantic integration tests."""

from __future__ import annotations

from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool


ANALYSIS_SELECTION: list[dict[str, object]] = [
    {
        "name": "requirements",
        "dimensions": [
            "title",
            "creator_name",
            "creator_employee_no",
        ],
    },
    {
        "name": "operations",
        "dimensions": [
            "action",
            "operator_name",
            "operator_employee_no",
        ],
    },
    {
        "name": "processes",
        "dimensions": ["process_name", "description"],
    },
    {
        "name": "parts",
        "dimensions": ["part_name", "part_code", "description"],
    },
]

EXPECTED_OPERATION_IDS = {
    "operations:101",
    "operations:102",
    "operations:103",
}
INVALID_OPERATION_ID = "operations:104"
EXPECTED_PART_IDS = {
    "parts:201",
    "parts:202",
    "parts:203",
}
UNRELATED_PART_ID = "parts:204"


def create_semantic_business_engine() -> Engine:
    """Create one shared in-memory SQLite database with real business rows."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    metadata = MetaData()
    requirements = Table(
        "requirements",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("title", String(200), nullable=False),
        Column("creator_name", String(100), nullable=False),
        Column("creator_employee_no", String(50), nullable=False),
        Column("private_note", String(200)),
    )
    operations = Table(
        "operations",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("action", String(200), nullable=False),
        Column("operator_name", String(100), nullable=False),
        Column("operator_employee_no", String(50), nullable=False),
        Column("private_note", String(200)),
    )
    processes = Table(
        "processes",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("process_name", String(200), nullable=False),
        Column("description", String(500), nullable=False),
        Column("private_note", String(200)),
    )
    parts = Table(
        "parts",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("part_name", String(200), nullable=False),
        Column("part_code", String(80), nullable=False),
        Column("description", String(500), nullable=False),
        Column("private_note", String(200)),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            requirements.insert(),
            [
                {
                    "id": 1,
                    "title": "转子装配质量需求",
                    "creator_name": "张三",
                    "creator_employee_no": "EMP-001",
                    "private_note": "未选择的需求内部备注",
                }
            ],
        )
        connection.execute(
            operations.insert(),
            [
                {
                    "id": 101,
                    "action": "创建转子装配工单",
                    "operator_name": "张三",
                    "operator_employee_no": "EMP-001",
                    "private_note": "第一条未选择操作备注",
                },
                {
                    "id": 102,
                    "action": "复核转子装配工艺",
                    "operator_name": "张三",
                    "operator_employee_no": "EMP-001",
                    "private_note": "第二条未选择操作备注",
                },
                {
                    "id": 103,
                    "action": "批准转子装配放行",
                    "operator_name": "张三",
                    "operator_employee_no": "EMP-001",
                    "private_note": "第三条未选择操作备注",
                },
                {
                    "id": 104,
                    "action": "查看转子装配工单",
                    "operator_name": "张三",
                    "operator_employee_no": "EMP-999",
                    "private_note": "同名不同工号，不得关联",
                },
            ],
        )
        connection.execute(
            processes.insert(),
            [
                {
                    "id": 10,
                    "process_name": "转子装配工艺",
                    "description": "依次安装转轴、轴承与转子铁芯，并完成动平衡检查。",
                    "private_note": "未选择的工艺内部备注",
                }
            ],
        )
        connection.execute(
            parts.insert(),
            [
                {
                    "id": 201,
                    "part_name": "转轴",
                    "part_code": "RTR-SHAFT-01",
                    "description": "转子装配使用的传动转轴。",
                    "private_note": "未选择的转轴备注",
                },
                {
                    "id": 202,
                    "part_name": "轴承",
                    "part_code": "RTR-BEARING-02",
                    "description": "转子装配使用的支撑轴承。",
                    "private_note": "未选择的轴承备注",
                },
                {
                    "id": 203,
                    "part_name": "转子铁芯",
                    "part_code": "RTR-CORE-03",
                    "description": "转子装配使用的叠片铁芯。",
                    "private_note": "未选择的铁芯备注",
                },
                {
                    "id": 204,
                    "part_name": "转子装配工艺卡片",
                    "part_code": "DOC-ROTOR-99",
                    "description": "记录转子装配工艺的纸质文件，不是装配零件。",
                    "private_note": "文本相似但业务无关，不得关联",
                },
            ],
        )
    return engine

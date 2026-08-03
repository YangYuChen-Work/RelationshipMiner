"""测试配置与 fixture — 使用 SQLite 内存库替代 MySQL。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import (
    create_engine,
    text,
    MetaData,
    Table,
    Column,
    Integer,
    String,
    ForeignKey,
)
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool

SQLITE_URL = "sqlite:///:memory:"


def create_test_engine() -> Engine:
    """创建 SQLite 内存库引擎并预置测试数据。

    使用 StaticPool 确保 :memory: 数据库在同一引擎实例下
    的所有连接共享同一个数据库。
    """
    engine = create_engine(
        SQLITE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    metadata = MetaData()

    Table(
        "users",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("name", String(100)),
        Column("email", String(200)),
        Column("class_name", String(500)),
    )

    Table(
        "orders",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("user_id", Integer, ForeignKey("users.id")),
        Column("amount", Integer),
        Column("name", String(100)),
        Column("className", String(500)),
    )

    Table(
        "products",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("title", String(200)),
        Column("price", Integer),
        Column("name", String(200)),
        Column("class_name", String(500)),
    )

    # 包含 `class` 字段的表 — 验证单名 class 也被识别为 class_name 候选
    Table(
        "categories",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("class", String(500)),
        Column("label", String(100)),
    )

    metadata.create_all(engine)

    with engine.connect() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, name, email, class_name) VALUES "
                "(1, 'Alice', 'alice@test.com', 'com.example.User'),"
                "(2, 'Bob', 'bob@test.com', 'com.example.Admin')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO orders "
                "(id, user_id, amount, name, className) VALUES "
                "(1, 1, 100, 'Order 1', 'com.example.Order'),"
                "(2, 2, 200, 'Order 2', 'com.example.Order')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO products "
                "(id, title, price, name, class_name) VALUES "
                "(1, 'Widget', 10, 'Widget', 'com.example.Product'),"
                "(2, 'Gadget', 20, 'Gadget', 'com.example.Product')"
            )
        )
        conn.commit()

    return engine


@pytest.fixture
def client():
    """创建带有测试数据库的 FastAPI TestClient。"""
    from main import app
    from database import get_engine

    engine = create_test_engine()

    # 覆盖 FastAPI 依赖 — 注入测试引擎
    def override_get_engine():
        return engine

    app.dependency_overrides[get_engine] = override_get_engine

    yield TestClient(app)

    # 清理
    app.dependency_overrides.clear()


@pytest.fixture
def engine():
    """直接提供测试引擎（用于单元测试）。"""
    return create_test_engine()

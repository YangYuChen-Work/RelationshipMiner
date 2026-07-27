"""测试 /api/tables 和 /api/tables/{table_name}/fields 端点。"""

import pytest
from fastapi.testclient import TestClient


class TestListTables:
    """GET /api/tables — 表列表端点测试。"""

    def test_returns_all_table_names(self, client: TestClient):
        """应返回数据库中所有用户表名，按字母排序。"""
        response = client.get("/api/tables")

        assert response.status_code == 200
        data = response.json()
        names = [t["name"] for t in data]
        assert names == ["categories", "orders", "products", "users"]

    def test_response_format(self, client: TestClient):
        """每个表项应为 {name: string} 格式。"""
        response = client.get("/api/tables")

        assert response.status_code == 200
        data = response.json()
        for item in data:
            assert "name" in item
            assert isinstance(item["name"], str)


class TestListFields:
    """GET /api/tables/{table_name}/fields — 字段列表端点测试。"""

    def test_returns_columns_for_valid_table(self, client: TestClient):
        """应返回指定表的所有列信息。"""
        response = client.get("/api/tables/users/fields")

        assert response.status_code == 200
        data = response.json()
        assert data["table_name"] == "users"
        assert len(data["columns"]) == 4  # id, name, email, class_name

    def test_marks_class_name_candidate(self, client: TestClient):
        """class_name 字段应被标记为 is_class_name=True。"""
        response = client.get("/api/tables/users/fields")

        columns = response.json()["columns"]
        class_name_cols = [c for c in columns if c["is_class_name"]]
        assert len(class_name_cols) == 1
        assert class_name_cols[0]["name"] == "class_name"

    def test_marks_classname_candidate(self, client: TestClient):
        """className 字段（驼峰命名）应被标记为 is_class_name=True。"""
        response = client.get("/api/tables/orders/fields")

        columns = response.json()["columns"]
        class_name_cols = [c for c in columns if c["is_class_name"]]
        assert len(class_name_cols) == 1
        assert class_name_cols[0]["name"] == "className"

    def test_no_class_name_for_table_without_it(self, client: TestClient):
        """无 class_name 字段的表应正常返回，is_class_name 全部为 false。"""
        response = client.get("/api/tables/products/fields")

        columns = response.json()["columns"]
        class_name_cols = [c for c in columns if c["is_class_name"]]
        assert len(class_name_cols) == 0
        assert len(columns) == 3  # id, title, price

    def test_class_field_recognized(self, client: TestClient):
        """class 字段（单名）也应被识别为 is_class_name=True。"""
        response = client.get("/api/tables/categories/fields")

        assert response.status_code == 200
        columns = response.json()["columns"]
        class_name_cols = [c for c in columns if c["is_class_name"]]
        assert len(class_name_cols) == 1
        assert class_name_cols[0]["name"] == "class"

    def test_404_for_nonexistent_table(self, client: TestClient):
        """不存在的表应返回 404 + 友好错误信息。"""
        response = client.get("/api/tables/nonexistent/fields")

        assert response.status_code == 404
        detail = response.json()["detail"]
        assert "不存在" in str(detail)


class TestHealthCheck:
    """GET /api/health — 健康检查端点测试。"""

    def test_returns_ok(self, client: TestClient):
        """应返回 {status: ok}。"""
        response = client.get("/api/health")

        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

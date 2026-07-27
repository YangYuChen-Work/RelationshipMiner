"""测试 POST /api/analyze + WebSocket /ws/analyze/{task_id} 端点。"""

import json
import pytest
from fastapi.testclient import TestClient


class TestPostAnalyze:
    """POST /api/analyze — 提交分析任务。"""

    def test_returns_task_id_on_valid_request(self, client: TestClient):
        """有效请求应返回 task_id。"""
        payload = {
            "tables": [
                {"name": "users", "fields": ["id", "name", "class_name"]},
                {"name": "orders", "fields": ["id", "user_id", "className"]},
            ]
        }
        response = client.post("/api/analyze", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data
        assert isinstance(data["task_id"], str)
        assert len(data["task_id"]) > 0

    def test_rejects_empty_tables(self, client: TestClient):
        """空表列表应返回 422 或 400。"""
        payload = {"tables": []}
        response = client.post("/api/analyze", json=payload)

        assert response.status_code >= 400

    def test_rejects_missing_tables_field(self, client: TestClient):
        """缺少 tables 字段应返回 422。"""
        response = client.post("/api/analyze", json={})

        assert response.status_code == 422


class TestAnalyzeWebSocket:
    """WebSocket /ws/analyze/{task_id} — 实时进度推送。"""

    def test_progress_messages_in_order(self, client: TestClient):
        """应收到按阶段顺序的进度消息。"""
        # 1. 创建分析任务
        payload = {
            "tables": [
                {"name": "users", "fields": ["id", "name", "class_name"]},
                {"name": "orders", "fields": ["id", "user_id", "className"]},
            ]
        }
        resp = client.post("/api/analyze", json=payload)
        task_id = resp.json()["task_id"]

        # 2. 连接 WebSocket
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            messages = []
            while True:
                data = ws.receive_json()
                messages.append(data)
                if data.get("phase") == 5 and "graph" in data:
                    break

        # 3. 验证阶段顺序 — 阶段号必须非递减
        phases = [m["phase"] for m in messages]
        assert phases == sorted(phases), (
            f"阶段号应非递减，实际: {phases}"
        )
        assert phases[0] == 1, f"应从阶段 1 开始，实际: {phases[0]}"
        assert phases[-1] == 5, f"应在阶段 5 结束，实际: {phases[-1]}"

    def test_progress_values_are_monotonic(self, client: TestClient):
        """进度值应单调递增。"""
        payload = {
            "tables": [
                {"name": "users", "fields": ["id", "name", "class_name"]},
                {"name": "orders", "fields": ["id", "user_id", "className"]},
            ]
        }
        resp = client.post("/api/analyze", json=payload)
        task_id = resp.json()["task_id"]

        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            messages = []
            while True:
                data = ws.receive_json()
                messages.append(data)
                if data.get("phase") == 5 and "graph" in data:
                    break

        progress_vals = [m["progress"] for m in messages]
        assert progress_vals == sorted(progress_vals), (
            f"进度应单调递增，实际: {progress_vals}"
        )
        assert progress_vals[-1] == 1.0, (
            f"最后一条进度应为 1.0，实际: {progress_vals[-1]}"
        )

    def test_final_message_contains_graph(self, client: TestClient):
        """最后一条消息应包含 graph 数据（nodes + edges）。"""
        payload = {
            "tables": [
                {"name": "users", "fields": ["id", "name", "class_name"]},
                {"name": "orders", "fields": ["id", "user_id", "className"]},
            ]
        }
        resp = client.post("/api/analyze", json=payload)
        task_id = resp.json()["task_id"]

        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            messages = []
            while True:
                data = ws.receive_json()
                messages.append(data)
                if data.get("phase") == 5 and "graph" in data:
                    break

        final = messages[-1]
        assert "graph" in final
        assert "nodes" in final["graph"]
        assert "edges" in final["graph"]
        assert isinstance(final["graph"]["nodes"], list)
        assert isinstance(final["graph"]["edges"], list)

    def test_nodes_have_required_fields(self, client: TestClient):
        """每个节点应有 id, source_table, field_values, degree。"""
        payload = {
            "tables": [
                {"name": "users", "fields": ["id", "name", "class_name"]},
            ]
        }
        resp = client.post("/api/analyze", json=payload)
        task_id = resp.json()["task_id"]

        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            messages = []
            while True:
                data = ws.receive_json()
                messages.append(data)
                if data.get("phase") == 5 and "graph" in data:
                    break

        nodes = messages[-1]["graph"]["nodes"]
        assert len(nodes) == 2  # 2 users
        for node in nodes:
            assert "id" in node
            assert "source_table" in node
            assert "field_values" in node
            assert "degree" in node
            # class_name 应被提取
            assert node["class_name"] is not None

    def test_invalid_task_id_returns_error(self, client: TestClient):
        """无效的 task_id 应在 WebSocket 连接中收到错误消息。"""
        with client.websocket_connect("/api/ws/analyze/nonexistent-task-id") as ws:
            data = ws.receive_json()
            assert "error" in data or data.get("phase") is not None

    def test_progress_field_types(self, client: TestClient):
        """验证进度消息各字段类型正确。"""
        payload = {
            "tables": [
                {"name": "users", "fields": ["id", "name", "class_name"]},
            ]
        }
        resp = client.post("/api/analyze", json=payload)
        task_id = resp.json()["task_id"]

        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            while True:
                data = ws.receive_json()
                assert isinstance(data["phase"], int)
                assert isinstance(data["message"], str)
                assert isinstance(data["progress"], (int, float))
                if data.get("phase") == 5 and "graph" in data:
                    break

    def test_nodes_count_matches_records(self, client: TestClient):
        """节点数应等于所有选中表的记录总数。"""
        payload = {
            "tables": [
                {"name": "users", "fields": ["id", "name", "class_name"]},
                {"name": "products", "fields": ["id", "title", "price"]},
            ]
        }
        resp = client.post("/api/analyze", json=payload)
        task_id = resp.json()["task_id"]

        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            messages = []
            while True:
                data = ws.receive_json()
                messages.append(data)
                if data.get("phase") == 5 and "graph" in data:
                    break

        nodes = messages[-1]["graph"]["nodes"]
        # users 表 2 行 + products 表 2 行 = 4 个节点
        assert len(nodes) == 4

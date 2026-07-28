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


class TestExportEndpoint:
    """GET /api/export/{task_id} — JSON 完整快照导出。"""

    def test_returns_full_snapshot_for_completed_task(self, client: TestClient):
        """完成的分析任务应返回包含 graph + raw_data + config + layout 的快照。"""
        # 1. 运行完整分析
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
                if data.get("phase") == 5 and "graph" in data:
                    break

        # 2. 调导出端点
        export_resp = client.get(f"/api/export/{task_id}")
        assert export_resp.status_code == 200
        snapshot = export_resp.json()

        # 验证结构
        assert "graph" in snapshot
        assert "raw_data" in snapshot
        assert "config" in snapshot
        assert "layout" in snapshot

        # graph 包含 nodes + edges
        assert "nodes" in snapshot["graph"]
        assert "edges" in snapshot["graph"]

        # raw_data 按表分组
        assert "users" in snapshot["raw_data"]
        assert len(snapshot["raw_data"]["users"]) == 2  # 2 rows

        # config 包含表选择和 AI 决策
        assert "tables" in snapshot["config"]
        assert "ai_decisions" in snapshot["config"]
        assert "class_name_fields" in snapshot["config"]

        # layout 为空列表（由前端填充）
        assert snapshot["layout"] == []

    def test_404_for_nonexistent_task(self, client: TestClient):
        """不存在的 task_id 应返回 404 + 友好错误信息。"""
        response = client.get("/api/export/nonexistent-task-id")

        assert response.status_code == 404
        detail = response.json()["detail"]
        assert "不存在" in str(detail)

    def test_400_for_pending_task(self, client: TestClient):
        """尚未开始或未完成的任务应返回 400。"""
        # 创建任务但不运行
        payload = {
            "tables": [
                {"name": "users", "fields": ["id", "name", "class_name"]},
            ]
        }
        resp = client.post("/api/analyze", json=payload)
        task_id = resp.json()["task_id"]

        # 直接调导出端点 — 任务状态为 pending
        export_resp = client.get(f"/api/export/{task_id}")
        assert export_resp.status_code == 400
        detail = export_resp.json()["detail"]
        assert "尚未完成" in str(detail)

    def test_export_raw_data_matches_records(self, client: TestClient):
        """导出的 raw_data 应与数据库中的记录一致。"""
        payload = {
            "tables": [
                {"name": "users", "fields": ["id", "name", "class_name"]},
                {"name": "orders", "fields": ["id", "user_id", "className"]},
            ]
        }
        resp = client.post("/api/analyze", json=payload)
        task_id = resp.json()["task_id"]

        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            while True:
                data = ws.receive_json()
                if data.get("phase") == 5 and "graph" in data:
                    break

        export_resp = client.get(f"/api/export/{task_id}")
        snapshot = export_resp.json()

        # 验证 users 原始数据字段
        users_records = snapshot["raw_data"]["users"]
        assert len(users_records) == 2
        for row in users_records:
            assert "id" in row
            assert "name" in row
            assert "class_name" in row

        # 验证 orders 原始数据字段
        orders_records = snapshot["raw_data"]["orders"]
        assert len(orders_records) == 2
        for row in orders_records:
            assert "id" in row
            assert "user_id" in row
            assert "className" in row


class TestAnalyzeErrorPaths:
    """异常路径测试 — 验证错误消息格式和状态码。"""

    def test_timeout_error_contains_chinese_prompt(self, client: TestClient):
        """超时错误应包含中文提示和建议。"""
        # 使用非常短的超时触发 AnalysisTimeoutError
        from engine.pipeline import AnalysisTimeoutError

        err = AnalysisTimeoutError(elapsed=1.0)
        msg = str(err)
        assert "分析超时" in msg
        assert "建议减少表数量或行数后重试" in msg

    def test_db_connection_error_format(self, client: TestClient):
        """数据库连接失败应返回包含中文提示的结构化错误。"""
        # 此测试验证错误响应格式 — 使用实际端点间接测试
        # 由于测试环境使用 SQLite，无法直接触发 DB 连接失败，
        # 因此验证错误处理结构的正确性
        response = client.get("/api/tables/nonexistent/fields")
        assert response.status_code == 404
        detail = response.json()["detail"]
        # 结构化错误格式
        assert "detail" in detail

    def test_websocket_receives_error_on_invalid_task(self, client: TestClient):
        """无效 task_id 的 WebSocket 连接应收到错误消息。"""
        with client.websocket_connect("/api/ws/analyze/invalid-task-id") as ws:
            data = ws.receive_json()
            assert "error" in data
            assert data["error"] == "任务不存在"

    def test_analyze_rejects_empty_tables_with_chinese_message(
        self, client: TestClient
    ):
        """空表列表应返回中文错误提示。"""
        response = client.post("/api/analyze", json={"tables": []})

        assert response.status_code == 400
        detail = response.json()["detail"]
        detail_text = detail.get("detail", str(detail)) if isinstance(detail, dict) else detail
        assert "请至少选择一张表" in str(detail_text)

    def test_nonexistent_table_in_analyze_returns_chinese_error(
        self, client: TestClient
    ):
        """分析请求中包含不存在的表应返回中文提示。"""
        response = client.post(
            "/api/analyze",
            json={
                "tables": [
                    {"name": "ghost_table", "fields": ["id"]},
                ]
            },
        )

        assert response.status_code == 400
        detail = response.json()["detail"]
        assert "不存在" in str(detail)

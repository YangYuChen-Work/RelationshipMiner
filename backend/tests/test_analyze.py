"""Public HTTP, WebSocket, and export contracts for semantic analysis."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect


def _final_message(ws) -> tuple[list[dict], dict]:
    """Read progress messages through the sole terminal semantic payload."""
    messages = []
    while True:
        message = ws.receive_json()
        messages.append(message)
        if message.get("phase") == "complete" and "graph" in message:
            return messages, message


class TestHealthReadiness:
    def test_reports_degraded_when_embedding_cache_is_missing(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path,
    ):
        from config import settings
        from engine.semantic import readiness

        incomplete_snapshot = (
            tmp_path
            / "models--BAAI--bge-small-zh-v1.5"
            / "snapshots"
            / "incomplete-revision"
        )
        incomplete_snapshot.mkdir(parents=True)
        (incomplete_snapshot / "config.json").write_text(
            "{}",
            encoding="utf-8",
        )
        monkeypatch.setattr(
            readiness,
            "_huggingface_cache_roots",
            lambda: (tmp_path,),
        )
        monkeypatch.setattr(
            settings,
            "EMBEDDING_MODEL",
            "BAAI/bge-small-zh-v1.5",
        )
        monkeypatch.setattr(
            settings,
            "DEEPSEEK_API_KEY",
            "sk-health-contract-secret",
        )
        monkeypatch.setattr(
            settings,
            "DEEPSEEK_MODEL",
            "deepseek-v4-flash",
        )

        response = client.get("/api/health")

        assert response.status_code == 200
        assert response.json() == {
            "status": "degraded",
            "database": "ready",
            "embedding_model": "missing",
            "llm": "configured",
        }

    def test_reports_ready_when_every_dependency_is_ready(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path,
    ):
        from config import settings
        from engine.semantic import readiness

        snapshot = (
            tmp_path
            / "models--BAAI--bge-small-zh-v1.5"
            / "snapshots"
            / "test-revision"
        )
        snapshot.mkdir(parents=True)
        (snapshot / "config.json").write_text("{}", encoding="utf-8")
        (snapshot / "model.safetensors").write_bytes(b"cached-weights")
        monkeypatch.setattr(
            readiness,
            "_huggingface_cache_roots",
            lambda: (tmp_path,),
        )
        monkeypatch.setattr(
            settings,
            "EMBEDDING_MODEL",
            "BAAI/bge-small-zh-v1.5",
        )
        monkeypatch.setattr(settings, "DEEPSEEK_API_KEY", "configured-key")
        monkeypatch.setattr(
            settings,
            "DEEPSEEK_MODEL",
            "deepseek-v4-flash",
        )

        assert client.get("/api/health").json() == {
            "status": "ready",
            "database": "ready",
            "embedding_model": "ready",
            "llm": "configured",
        }

    def test_sanitizes_dependency_errors_and_reports_missing_llm_config(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path,
    ):
        from config import settings
        from database import get_engine
        from engine.semantic import readiness
        from main import app

        sensitive_values = {
            "sk-never-serialize-this",
            "mysql+pymysql://secret-user:secret-password@db/private",
            "private prompt body",
            "private response body",
            "entity value 8848",
            "field value 9900",
        }

        class FailingEngine:
            def connect(self):
                raise RuntimeError(" | ".join(sorted(sensitive_values)))

        app.dependency_overrides[get_engine] = FailingEngine
        monkeypatch.setattr(
            readiness,
            "_huggingface_cache_roots",
            lambda: (tmp_path,),
        )
        monkeypatch.setattr(
            settings,
            "EMBEDDING_MODEL",
            "BAAI/bge-small-zh-v1.5",
        )
        monkeypatch.setattr(
            settings,
            "DEEPSEEK_API_KEY",
            "sk-never-serialize-this",
        )
        monkeypatch.setattr(settings, "DEEPSEEK_MODEL", "")
        monkeypatch.setattr(settings, "DB_USER", "secret-user")
        monkeypatch.setattr(settings, "DB_PASSWORD", "secret-password")
        monkeypatch.setattr(settings, "DB_HOST", "db")
        monkeypatch.setattr(settings, "DB_NAME", "private")
        sensitive_values.add(settings.database_url)

        response = client.get("/api/health")
        serialized = response.text

        assert response.status_code == 200
        assert response.json() == {
            "status": "degraded",
            "database": "unavailable",
            "embedding_model": "missing",
            "llm": "missing",
        }
        assert all(value not in serialized for value in sensitive_values)


class TestPostAnalyze:
    def test_returns_task_id_on_valid_request(self, client: TestClient):
        response = client.post(
            "/api/analyze",
            json={"tables": [{"name": "users", "fields": ["name"]}]},
        )
        assert response.status_code == 200
        assert isinstance(response.json()["task_id"], str)

    def test_rejects_empty_tables(self, client: TestClient):
        assert client.post("/api/analyze", json={"tables": []}).status_code >= 400

    def test_rejects_missing_tables_field(self, client: TestClient):
        assert client.post("/api/analyze", json={}).status_code == 422

    def test_accepts_dimensions_and_legacy_fields(self, client: TestClient):
        for selection in ({"dimensions": ["name"]}, {"fields": ["name"]}):
            response = client.post(
                "/api/analyze",
                json={"tables": [{"name": "users", **selection}]},
            )
            assert response.status_code == 200

    def test_class_name_is_not_required(self, client: TestClient):
        response = client.post(
            "/api/analyze",
            json={"tables": [{"name": "products", "dimensions": ["title"]}]},
        )
        assert response.status_code == 200


class TestAnalyzeWebSocket:
    def test_semantic_analyzer_only_over_http_and_websocket(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """The public API completes without entering either legacy path."""
        import engine.ai_decision_maker as legacy_decider
        import engine.pipeline as pipeline
        import engine.relationship_computer as legacy_computer
        from engine.semantic.analyzer import RelationshipAnalyzer

        class EmptyPlanner:
            async def plan(self, *args: object, **kwargs: object) -> list[object]:
                return []

        class UnusedEmbeddings:
            def encode_documents(self, texts: list[str]) -> list[list[float]]:
                raise AssertionError("no semantic retrieval is planned")

            def encode_queries(self, texts: list[str]) -> list[list[float]]:
                raise AssertionError("no semantic retrieval is planned")

        class UnusedJudge:
            async def judge_groups(
                self,
                groups: list[object],
                deadline: float,
            ) -> object:
                raise AssertionError("no semantic candidates are planned")

        def legacy_path_must_not_run(*args: object, **kwargs: object) -> object:
            raise AssertionError("the legacy relationship path was invoked")

        analyzer = RelationshipAnalyzer(
            planner=EmptyPlanner(),
            embedding_adapter=UnusedEmbeddings(),
            judge=UnusedJudge(),
        )
        constructed: list[RelationshipAnalyzer] = []

        def semantic_analyzer_factory() -> RelationshipAnalyzer:
            constructed.append(analyzer)
            return analyzer

        monkeypatch.setattr(
            legacy_decider,
            "decide_matches",
            legacy_path_must_not_run,
        )
        monkeypatch.setattr(
            legacy_computer,
            "compute_relationships",
            legacy_path_must_not_run,
        )
        monkeypatch.setattr(
            pipeline,
            "RelationshipAnalyzer",
            semantic_analyzer_factory,
        )

        task_id = client.post(
            "/api/analyze",
            json={"tables": [
                {"name": "users", "dimensions": ["name"]},
                {"name": "orders", "dimensions": ["amount"]},
            ]},
        ).json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            _, final = _final_message(ws)

        assert constructed == [analyzer]
        assert final["status"] == "complete"
        assert final["graph"]["entity_edges"]

    def test_analysis_adds_primary_key_when_not_selected(self, client: TestClient):
        task_id = client.post(
            "/api/analyze",
            json={"tables": [{"name": "users", "fields": ["name"]}]},
        ).json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            _, final = _final_message(ws)
        assert {node["id"] for node in final["graph"]["entity_nodes"]} == {
            "users:1", "users:2"
        }

    def test_analysis_adds_foreign_key_when_not_selected(self, client: TestClient):
        task_id = client.post(
            "/api/analyze",
            json={"tables": [
                {"name": "users", "fields": ["name"]},
                {"name": "orders", "fields": ["amount"]},
            ]},
        ).json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            _, final = _final_message(ws)
        assert len(final["graph"]["entity_edges"]) == 2
        assert all(
            relation["evidence"][0]["method"] == "foreign_key"
            for edge in final["graph"]["entity_edges"]
            for relation in edge["relations"]
        )

    def test_progress_messages_in_order(self, client: TestClient):
        task_id = client.post(
            "/api/analyze",
            json={"tables": [
                {"name": "users", "dimensions": ["name"]},
                {"name": "orders", "dimensions": ["amount"]},
            ]},
        ).json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            messages, final = _final_message(ws)
        phases = [message["phase"] for message in messages]
        assert phases[0] == "schema"
        assert phases[-1] == "complete"
        assert phases.count("complete") == 1
        assert final["progress"] == 1.0

    def test_progress_values_are_monotonic(self, client: TestClient):
        task_id = client.post(
            "/api/analyze",
            json={"tables": [{"name": "users", "dimensions": ["name"]}]},
        ).json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            messages, _ = _final_message(ws)
        progress = [message["progress"] for message in messages]
        assert progress == sorted(progress)
        assert progress[-1] == 1.0

    def test_final_message_contains_graph(self, client: TestClient):
        task_id = client.post(
            "/api/analyze",
            json={"tables": [{"name": "users", "fields": ["name"]}]},
        ).json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            _, final = _final_message(ws)
        assert final["phase"] == "complete"
        assert set(final) >= {"phase", "progress", "status", "graph", "diagnostics", "warnings"}
        assert set(final["graph"]) == {
            "table_nodes", "entity_nodes", "table_edges", "entity_edges"
        }

    def test_nodes_have_required_fields(self, client: TestClient):
        task_id = client.post(
            "/api/analyze",
            json={"tables": [{"name": "users", "fields": ["name"]}]},
        ).json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            _, final = _final_message(ws)
        nodes = final["graph"]["entity_nodes"]
        assert len(nodes) == 2
        assert all({"id", "table_id", "display_name", "class_name", "dimensions"} <= node.keys() for node in nodes)

    def test_invalid_task_id_returns_error(self, client: TestClient):
        with client.websocket_connect("/api/ws/analyze/nonexistent-task-id") as ws:
            assert ws.receive_json()["error"] == "任务不存在"
            with pytest.raises(WebSocketDisconnect):
                ws.receive_json()

    def test_progress_field_types(self, client: TestClient):
        task_id = client.post(
            "/api/analyze",
            json={"tables": [{"name": "users", "fields": ["name"]}]},
        ).json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            messages, final = _final_message(ws)
        assert all(isinstance(message["phase"], str) for message in messages)
        assert all(isinstance(message["message"], str) for message in messages[:-1])
        assert all(isinstance(message["progress"], (int, float)) for message in messages)
        assert isinstance(final["diagnostics"]["entities_read"], int)

    def test_nodes_count_matches_records(self, client: TestClient):
        task_id = client.post(
            "/api/analyze",
            json={"tables": [
                {"name": "users", "fields": ["name"]},
                {"name": "products", "fields": ["title", "price"]},
            ]},
        ).json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            _, final = _final_message(ws)
        assert len(final["graph"]["entity_nodes"]) == 4

    def test_unexpected_pipeline_error_is_terminal_failed_result(self, client: TestClient, monkeypatch):
        import routers.analyze as analyze_router

        monkeypatch.setattr(analyze_router, "run_analysis_pipeline", AsyncMock(side_effect=RuntimeError("broken")))
        task_id = client.post(
            "/api/analyze",
            json={"tables": [{"name": "users", "fields": ["name"]}]},
        ).json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            _, final = _final_message(ws)
        assert final["status"] == "failed"
        assert final["graph"]["entity_edges"] == []
        assert final["warnings"]

    @pytest.mark.asyncio
    async def test_final_send_failure_keeps_completed_registry_result_once(
        self, engine, monkeypatch
    ):
        import routers.analyze as analyze_router
        from engine.semantic.models import (
            AnalysisDiagnostics,
            AnalysisResult,
            AnalysisStatus,
        )

        task_id = "send-failure"
        result = AnalysisResult(
            status=AnalysisStatus.COMPLETE,
            table_nodes=[], entity_nodes=[], table_edges=[], entity_edges=[],
            diagnostics=AnalysisDiagnostics(), warnings=[],
        )
        analyze_router._task_registry[task_id] = {
            "status": "pending", "request": {"tables": []},
        }
        monkeypatch.setattr(
            analyze_router, "run_analysis_pipeline", AsyncMock(return_value=result)
        )
        ws = SimpleNamespace(
            accept=AsyncMock(),
            send_json=AsyncMock(side_effect=RuntimeError("socket closed")),
            close=AsyncMock(),
        )

        await analyze_router.analyze_progress(ws, task_id, engine)

        task = analyze_router._task_registry[task_id]
        assert task["status"] == "done"
        assert task["result"] is result
        assert ws.send_json.await_count == 1
        assert ws.close.await_count == 1

    @pytest.mark.asyncio
    async def test_registry_is_complete_before_final_message_is_observable(
        self, engine, monkeypatch
    ):
        import routers.analyze as analyze_router
        from engine.semantic.models import (
            AnalysisDiagnostics,
            AnalysisResult,
            AnalysisStatus,
        )

        task_id = "atomic-result"
        result = AnalysisResult(
            status=AnalysisStatus.PARTIAL,
            table_nodes=[], entity_nodes=[], table_edges=[], entity_edges=[],
            diagnostics=AnalysisDiagnostics(entities_read=3), warnings=["warning"],
        )
        analyze_router._task_registry[task_id] = {
            "status": "pending", "request": {"tables": []},
        }
        monkeypatch.setattr(
            analyze_router, "run_analysis_pipeline", AsyncMock(return_value=result)
        )

        async def observe_final(payload):
            task = analyze_router._task_registry[task_id]
            assert task["status"] == "done"
            assert task["result"] is result
            exported = analyze_router.export_analysis_snapshot(task_id)
            assert exported["diagnostics"]["entities_read"] == 3

        ws = SimpleNamespace(
            accept=AsyncMock(), send_json=AsyncMock(side_effect=observe_final), close=AsyncMock(),
        )
        await analyze_router.analyze_progress(ws, task_id, engine)


class TestExportEndpoint:
    def test_returns_full_snapshot_for_completed_task(self, client: TestClient):
        task_id = client.post(
            "/api/analyze",
            json={"tables": [{"name": "users", "fields": ["name"]}]},
        ).json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            _, final = _final_message(ws)
        response = client.get(f"/api/export/{task_id}")
        assert response.status_code == 200
        exported = response.json()
        assert exported["status"] == final["status"]
        assert exported["graph"] == final["graph"]
        assert exported["diagnostics"] == final["diagnostics"]
        assert exported["warnings"] == final["warnings"]

    def test_404_for_nonexistent_task(self, client: TestClient):
        response = client.get("/api/export/nonexistent-task-id")
        assert response.status_code == 404
        assert response.json()["detail"] == {
            "detail": "任务不存在或已过期",
            "suggestion": "请重新提交分析任务。",
        }

    def test_400_for_pending_task(self, client: TestClient):
        task_id = client.post(
            "/api/analyze",
            json={"tables": [{"name": "users", "fields": ["name"]}]},
        ).json()["task_id"]
        response = client.get(f"/api/export/{task_id}")
        assert response.status_code == 400
        assert response.json()["detail"] == {
            "detail": "分析尚未完成",
            "suggestion": "请等待分析完成后再导出。",
        }

    def test_export_raw_data_matches_records(self, client: TestClient):
        """The export must be the semantic result projection, never a recomputation."""
        task_id = client.post(
            "/api/analyze",
            json={"tables": [
                {"name": "users", "fields": ["name"]},
                {"name": "orders", "fields": ["amount"]},
            ]},
        ).json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            _, final = _final_message(ws)
        exported = client.get(f"/api/export/{task_id}").json()
        assert exported["graph"]["entity_nodes"] == final["graph"]["entity_nodes"]
        assert len(exported["graph"]["entity_nodes"]) == 4


class TestAnalyzeErrorPaths:
    def test_timeout_error_contains_chinese_prompt(self, client: TestClient, monkeypatch):
        from engine.semantic import analyzer
        from engine.semantic.models import AnalysisScope, TableScope
        from tests.conftest import create_test_engine

        values = iter([0.0, 2.0])
        monkeypatch.setattr(
            analyzer, "time", SimpleNamespace(monotonic=lambda: next(values))
        )
        result = asyncio.run(analyzer.RelationshipAnalyzer(
            planner=SimpleNamespace(plan=AsyncMock(return_value=[])),
            embedding_adapter=SimpleNamespace(),
            judge=SimpleNamespace(),
        ).analyze(
            create_test_engine(),
            AnalysisScope(
                tables=[TableScope(name="users", dimensions=["name"])],
                time_budget_seconds=1,
            ),
        ))
        assert result.status == "partial"
        assert result.warnings == ["分析超时：读取 Schema 前已达到时间预算。"]

    def test_db_connection_error_format(self, client: TestClient):
        response = client.get("/api/tables/nonexistent/fields")
        assert response.status_code == 404
        assert "detail" in response.json()["detail"]

    def test_websocket_receives_error_on_invalid_task(self, client: TestClient):
        with client.websocket_connect("/api/ws/analyze/invalid-task-id") as ws:
            assert ws.receive_json()["error"] == "任务不存在"

    def test_analyze_rejects_empty_tables_with_chinese_message(self, client: TestClient):
        response = client.post("/api/analyze", json={"tables": []})
        assert response.status_code == 400
        assert "请至少选择一张表" in str(response.json()["detail"])

    def test_nonexistent_table_in_analyze_returns_chinese_error(self, client: TestClient):
        response = client.post(
            "/api/analyze",
            json={"tables": [{"name": "ghost_table", "fields": ["id"]}]},
        )
        assert response.status_code == 400
        assert "不存在" in str(response.json()["detail"])

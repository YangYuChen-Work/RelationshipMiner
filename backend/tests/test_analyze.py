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
    @staticmethod
    def _write_complete_model(directory):
        directory.mkdir(parents=True)
        (directory / "config.json").write_text("{}", encoding="utf-8")
        (directory / "model.safetensors").write_bytes(b"cached-weights")

    def test_health_requires_complete_recognized_weight_artifacts(
        self,
        tmp_path,
    ):
        from engine.semantic import readiness

        def snapshot(name: str):
            directory = tmp_path / name
            directory.mkdir()
            (directory / "config.json").write_text("{}", encoding="utf-8")
            return directory

        unrelated = snapshot("unrelated")
        (unrelated / "adapter.safetensors").write_bytes(b"not-the-model")

        empty_single = snapshot("empty-single")
        (empty_single / "model.safetensors").write_bytes(b"")

        empty_pytorch = snapshot("empty-pytorch")
        (empty_pytorch / "pytorch_model.bin").write_bytes(b"")

        pytorch_single = snapshot("pytorch-single")
        (pytorch_single / "pytorch_model.bin").write_bytes(
            b"nonempty-weights",
        )

        missing_index = snapshot("missing-index")
        (missing_index / "model-00001-of-00002.safetensors").write_bytes(
            b"first-shard",
        )
        (missing_index / "model-00002-of-00002.safetensors").write_bytes(
            b"second-shard",
        )

        incomplete_shards = snapshot("incomplete-shards")
        (incomplete_shards / "model-00001-of-00002.safetensors").write_bytes(
            b"first-shard",
        )
        (incomplete_shards / "model.safetensors.index.json").write_text(
            '{"weight_map":{"a":"model-00001-of-00002.safetensors",'
            '"b":"model-00002-of-00002.safetensors"}}',
            encoding="utf-8",
        )

        complete_shards = snapshot("complete-shards")
        for shard in (
            "pytorch_model-00001-of-00002.bin",
            "pytorch_model-00002-of-00002.bin",
        ):
            (complete_shards / shard).write_bytes(b"nonempty-shard")
        (
            complete_shards / "pytorch_model.bin.index.json"
        ).write_text(
            '{"weight_map":{"a":"pytorch_model-00001-of-00002.bin",'
            '"b":"pytorch_model-00002-of-00002.bin"}}',
            encoding="utf-8",
        )

        complete_safe_shards = snapshot("complete-safe-shards")
        for shard in (
            "model-00001-of-00002.safetensors",
            "model-00002-of-00002.safetensors",
        ):
            (complete_safe_shards / shard).write_bytes(b"nonempty-shard")
        (
            complete_safe_shards / "model.safetensors.index.json"
        ).write_text(
            '{"weight_map":{"a":"model-00001-of-00002.safetensors",'
            '"b":"model-00002-of-00002.safetensors"}}',
            encoding="utf-8",
        )

        assert readiness._is_model_snapshot(unrelated) is False
        assert readiness._is_model_snapshot(empty_single) is False
        assert readiness._is_model_snapshot(empty_pytorch) is False
        assert readiness._is_model_snapshot(pytorch_single) is True
        assert readiness._is_model_snapshot(missing_index) is False
        assert readiness._is_model_snapshot(incomplete_shards) is False
        assert readiness._is_model_snapshot(complete_shards) is True
        assert readiness._is_model_snapshot(complete_safe_shards) is True

    @pytest.mark.parametrize(
        "unsafe_repo_id",
        [
            r"owner\model",
            "..",
            "../model",
            "owner/../model",
            "/absolute/model",
            r"C:\absolute\model",
            "C:drive-relative",
            "owner//model",
            "owner/model/extra",
        ],
    )
    def test_health_rejects_unsafe_hf_repo_ids(self, unsafe_repo_id):
        from engine.semantic import readiness

        assert readiness._is_safe_hf_repo_id(unsafe_repo_id) is False

    def test_health_rejects_windows_backslash_cache_escape(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path,
    ):
        from engine.semantic import readiness

        cache_root = tmp_path / "cache"
        cache_root.mkdir()
        self._write_complete_model(tmp_path / "escaped-model")
        monkeypatch.setattr(
            readiness,
            "_huggingface_cache_roots",
            lambda: (cache_root,),
        )

        assert (
            readiness._embedding_model_status(r"..\escaped-model")
            == "missing"
        )

    def test_health_treats_only_absolute_paths_as_local_models(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path,
    ):
        from engine.semantic import readiness

        local_model = tmp_path / "local-model"
        self._write_complete_model(local_model)
        empty_cache = tmp_path / "cache"
        empty_cache.mkdir()
        monkeypatch.setattr(
            readiness,
            "_huggingface_cache_roots",
            lambda: (empty_cache,),
        )
        monkeypatch.chdir(tmp_path)

        assert readiness._embedding_model_status(str(local_model)) == "ready"
        assert readiness._embedding_model_status("local-model") == "missing"

    @pytest.mark.parametrize(
        ("selected", "unset"),
        [
            ("sentence", ()),
            ("hub", ("sentence",)),
            ("legacy", ("sentence", "hub")),
            ("home", ("sentence", "hub", "legacy")),
            (
                "default",
                ("sentence", "hub", "legacy", "home"),
            ),
        ],
    )
    def test_health_uses_sentence_transformer_cache_priority(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path,
        selected,
        unset,
    ):
        from engine.semantic import readiness

        roots = {
            "sentence": tmp_path / "sentence-cache",
            "hub": tmp_path / "hub-cache",
            "legacy": tmp_path / "legacy-cache",
            "home": tmp_path / "hf-home",
            "default": tmp_path / "xdg" / "huggingface" / "hub",
        }
        environment = {
            "sentence": ("SENTENCE_TRANSFORMERS_HOME", roots["sentence"]),
            "hub": ("HF_HUB_CACHE", roots["hub"]),
            "legacy": ("HUGGINGFACE_HUB_CACHE", roots["legacy"]),
            "home": ("HF_HOME", roots["home"]),
        }
        for _, (name, value) in environment.items():
            monkeypatch.setenv(name, str(value))
        monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "xdg"))
        for level in unset:
            monkeypatch.delenv(environment[level][0], raising=False)

        expected = (
            roots[selected] / "hub"
            if selected == "home"
            else roots[selected]
        ).resolve()

        assert readiness._huggingface_cache_roots() == (expected,)

    @pytest.mark.parametrize(
        "empty_variable",
        ["SENTENCE_TRANSFORMERS_HOME", "HF_HUB_CACHE"],
    )
    def test_health_explicit_empty_cache_root_does_not_fall_back(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path,
        empty_variable,
    ):
        from engine.semantic import readiness

        current_directory = tmp_path / "working-directory"
        current_directory.mkdir()
        fallback = tmp_path / "fallback"
        self._write_complete_model(
            fallback
            / "models--BAAI--bge-small-zh-v1.5"
            / "snapshots"
            / "complete",
        )
        monkeypatch.chdir(current_directory)
        monkeypatch.delenv(
            "SENTENCE_TRANSFORMERS_HOME",
            raising=False,
        )
        monkeypatch.setenv("HF_HUB_CACHE", str(fallback))
        monkeypatch.setenv("HF_HOME", str(tmp_path / "hf-home"))
        monkeypatch.setenv(empty_variable, "")

        assert (
            readiness._embedding_model_status(
                "BAAI/bge-small-zh-v1.5",
            )
            == "missing"
        )
        assert readiness._huggingface_cache_roots() == (
            current_directory.resolve(),
        )

    @pytest.mark.parametrize(
        "placeholder",
        [
            "",
            "   ",
            "<your-key>",
            " YOUR-KEY ",
            "changeme",
            "Change_Me",
            "example",
            "EXAMPLE-KEY",
            "<API_KEY>",
            "replace-with-your-key",
            "placeholder",
            "dummy",
            "test-key",
        ],
    )
    def test_health_rejects_placeholder_llm_keys(self, placeholder):
        from engine.semantic import readiness

        assert (
            readiness._llm_status(placeholder, "deepseek-v4-flash")
            == "missing"
        )

    def test_health_accepts_nonplaceholder_llm_key(self):
        from engine.semantic import readiness

        assert (
            readiness._llm_status(
                "sk-production-account-4f29",
                "deepseek-v4-flash",
            )
            == "configured"
        )

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
        pipeline._shared_analyzer = None

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

        monkeypatch.setattr(analyze_router, "run_analysis_pipeline", AsyncMock(side_effect=RuntimeError("db_password=super-secret")))
        task_id = client.post(
            "/api/analyze",
            json={"tables": [{"name": "users", "fields": ["name"]}]},
        ).json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            _, final = _final_message(ws)
        assert final["status"] == "failed"
        assert final["graph"]["entity_edges"] == []
        assert final["warnings"]
        assert "super-secret" not in str(final)
        exported = client.get(f"/api/export/{task_id}").json()
        assert "super-secret" not in str(exported)

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
    def test_final_payload_encodes_binary_dimensions_for_websocket_and_export(self):
        from engine.semantic.models import (
            AnalysisDiagnostics,
            AnalysisResult,
            AnalysisStatus,
            EntityNode,
        )
        from routers.analyze import _final_payload

        result = AnalysisResult(
            status=AnalysisStatus.COMPLETE,
            table_nodes=[],
            entity_nodes=[EntityNode(
                id="table:1", table_id="table", display_name="binary",
                dimensions={"payload": b"\xff\x00"},
            )],
            table_edges=[], entity_edges=[], diagnostics=AnalysisDiagnostics(), warnings=[],
        )

        payload = _final_payload(result)
        assert payload["graph"]["entity_nodes"][0]["dimensions"]["payload"] == {
            "$type": "bytes", "encoding": "base64", "value": "/wA="
        }

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

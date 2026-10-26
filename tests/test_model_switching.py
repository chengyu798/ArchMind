"""模型切换回归：配置边界、失败回退，以及进行中回答的模型一致性。"""
from copy import deepcopy
from importlib import import_module
from types import SimpleNamespace

import pytest
import yaml
from fastapi import HTTPException
from langchain_core.messages import AIMessageChunk
from pydantic import ValidationError


@pytest.fixture
def settings(tmp_path, monkeypatch):
    # 首次加载服务时将 Chroma/日志等副作用隔离到测试目录。
    from app.utils import path_tool

    original_path = path_tool.get_abs_path
    monkeypatch.setattr(
        path_tool,
        "get_abs_path",
        lambda path: str(tmp_path / path) if path.startswith(("data/", "logs/")) else original_path(path),
    )
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-only-key")
    service = import_module("app.services.settings_service")
    config = {
        "chat": {"provider": "deepseek", "model_name": "model-a"},
        "embedding": {"provider": "dashscope", "model_name": "fixed-embedding"},
        "providers": {
            "deepseek": {"base_url": "https://example.test", "api_key_env": "TEST_KEY"},
            "dashscope": {"api_key_env": "DASHSCOPE_API_KEY"},
            "internal-only": {"embedding_model": "private-embedding"},
        },
    }
    path = tmp_path / "model.yaml"
    path.write_text(yaml.safe_dump(config), encoding="utf-8")
    monkeypatch.setattr(service, "MODEL_CONFIG_PATH", str(path))
    monkeypatch.setattr(service, "validate_chat_runtime", lambda candidate: None)
    return SimpleNamespace(service=service, config=config, path=path)


def test_public_settings_hide_embedding_and_backend_provider_details(settings):
    result = settings.service.get_model_settings().model_dump()
    assert result == {"chat_provider": "deepseek", "chat_model": "model-a", "providers": ["dashscope", "deepseek"]}


def test_settings_api_rejects_embedding_updates_and_blank_models():
    from app.schemas.settings import ModelSettingsUpdateRequest

    with pytest.raises(ValidationError):
        ModelSettingsUpdateRequest(chat_provider="deepseek", chat_model="model-b", embedding_model="changed")
    with pytest.raises(ValidationError):
        ModelSettingsUpdateRequest(chat_provider="deepseek", chat_model="   ")


def test_successful_switch_preserves_all_backend_configuration(settings, monkeypatch):
    from app.schemas.settings import ModelSettingsUpdateRequest

    validated = []
    monkeypatch.setattr(settings.service, "validate_chat_runtime", lambda candidate: validated.append(deepcopy(candidate)))
    result = settings.service.update_model_settings(ModelSettingsUpdateRequest(chat_provider=" deepseek ", chat_model=" model-b "))
    expected = deepcopy(settings.config)
    expected["chat"]["model_name"] = "model-b"
    assert yaml.safe_load(settings.path.read_text()) == expected
    assert validated == [expected]
    assert result.chat_model == "model-b"


def test_failed_model_validation_preserves_current_config(settings, monkeypatch):
    from app.schemas.settings import ModelSettingsUpdateRequest

    original = settings.path.read_bytes()

    def unavailable(candidate):
        raise RuntimeError("upstream unavailable")

    monkeypatch.setattr(settings.service, "validate_chat_runtime", unavailable)
    with pytest.raises(HTTPException) as error:
        settings.service.update_model_settings(ModelSettingsUpdateRequest(chat_provider="deepseek", chat_model="bad-model"))
    assert error.value.status_code == 400
    assert settings.path.read_bytes() == original
    assert settings.service.get_model_settings().chat_model == "model-a"


def test_unknown_provider_is_rejected_before_validation(settings, monkeypatch):
    from app.schemas.settings import ModelSettingsUpdateRequest

    def unexpected(candidate):
        pytest.fail("未知 provider 不应触发外部模型调用")

    monkeypatch.setattr(settings.service, "validate_chat_runtime", unexpected)
    with pytest.raises(HTTPException) as error:
        settings.service.update_model_settings(ModelSettingsUpdateRequest(chat_provider="unknown", chat_model="model-b"))
    assert error.value.status_code == 400
    assert yaml.safe_load(settings.path.read_text()) == settings.config


def test_failed_config_write_keeps_old_model(settings, monkeypatch):
    from app.schemas.settings import ModelSettingsUpdateRequest

    original = settings.path.read_bytes()
    original_paths = set(settings.path.parent.iterdir())

    def unwritable(*args):
        raise OSError("read-only filesystem")

    monkeypatch.setattr(settings.service.os, "replace", unwritable)
    with pytest.raises(OSError):
        settings.service.update_model_settings(ModelSettingsUpdateRequest(chat_provider="deepseek", chat_model="model-b"))
    assert settings.path.read_bytes() == original
    assert set(settings.path.parent.iterdir()) == original_paths


@pytest.mark.parametrize("provider, options", [("deepseek", {"timeout": 20}), ("dashscope", {"request_timeout": 20}), ("ollama", {})])
def test_validation_supports_provider_specific_request_options(settings, monkeypatch, provider, options):
    from app.agent import runtime

    calls = []

    class FakeModel:
        def bind_tools(self, tools):
            return self

        def invoke(self, message, **kwargs):
            calls.append(kwargs)

    monkeypatch.setattr(runtime, "get_chat_runtime", lambda config: SimpleNamespace(model=FakeModel()))
    runtime.validate_chat_runtime({"chat": {"provider": provider}})
    assert calls == [options]


def test_existing_consumers_switch_models_but_inflight_answer_keeps_its_model(settings, monkeypatch):
    from app.agent import runtime
    from app.agent.agent import UserAgentService

    runtime._runtime_for_config.cache_clear()
    monkeypatch.setattr(runtime, "load_model_config", lambda: yaml.safe_load(settings.path.read_text()))
    created_models = []

    class FakeFactory:
        def __init__(self, config):
            self.name = config["chat"]["model_name"]

        def generator(self):
            created_models.append(self.name)
            return self.name

    class FakeAgent:
        def __init__(self, model):
            self.model = model

        def stream(self, *args, **kwargs):
            for part in ("first", "last"):
                yield {"type": "messages", "data": (AIMessageChunk(content=f"{self.model}:{part}"), {})}

    monkeypatch.setattr(runtime, "ChatModelFactory", FakeFactory)
    monkeypatch.setattr(runtime, "create_agent", lambda model, **kwargs: FakeAgent(model))
    chat_consumer = UserAgentService()
    report_consumer = UserAgentService()
    inflight = chat_consumer._stream_events_direct("hello", 1)
    try:
        assert next(inflight)["content"] == "model-a:first"
        changed = deepcopy(settings.config)
        changed["chat"]["model_name"] = "model-b"
        settings.path.write_text(yaml.safe_dump(changed))
        assert list(inflight)[0]["content"] == "model-a:last"
        for consumer in (chat_consumer, report_consumer):
            events = list(consumer._stream_events_direct("hello", 1))
            assert "".join(event["content"] for event in events) == "model-b:firstmodel-b:last"
        assert created_models == ["model-a", "model-b"]
    finally:
        runtime._runtime_for_config.cache_clear()

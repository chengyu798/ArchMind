"""聊天模型即时切换；Embedding 配置仅由开发者在后端维护。"""
import os
import tempfile
from pathlib import Path
from threading import Lock

import yaml
from fastapi import HTTPException, status

from app.agent.runtime import validate_chat_runtime
from app.schemas.settings import ModelSettingsResponse, ModelSettingsUpdateRequest, RagSettingsResponse, RagSettingsUpdateRequest
from app.utils.config_loading_tool import load_model_config, load_rag_config
from app.utils.logger_tool import logger
from app.utils.path_tool import get_abs_path

MODEL_CONFIG_PATH = get_abs_path("config/model.yaml")
RAG_CONFIG_PATH = get_abs_path("config/rag.yaml")
CHAT_PROVIDERS = {"dashscope", "deepseek", "ollama", "openai"}
MODEL_SETTINGS_LOCK = Lock()


def get_model_settings() -> ModelSettingsResponse:
    config = load_model_config(MODEL_CONFIG_PATH)
    return ModelSettingsResponse(
        chat_provider=config["chat"]["provider"],
        chat_model=config["chat"]["model_name"],
        providers=[provider for provider in config["providers"] if provider in CHAT_PROVIDERS],
    )


def get_rag_settings() -> RagSettingsResponse:
    config = load_rag_config(RAG_CONFIG_PATH)
    return RagSettingsResponse(
        k=config["k"],
        chunk_size=config["chunk_size"],
        chunk_overlap=config["chunk_overlap"],
        separators=config["separators"],
    )


def update_model_settings(payload: ModelSettingsUpdateRequest) -> ModelSettingsResponse:
    with MODEL_SETTINGS_LOCK:
        config = load_model_config(MODEL_CONFIG_PATH)
        if payload.chat_provider not in config["providers"] or payload.chat_provider not in CHAT_PROVIDERS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的聊天模型 provider")

        config["chat"]["provider"] = payload.chat_provider
        config["chat"]["model_name"] = payload.chat_model
        try:
            validate_chat_runtime(config)
        except Exception:
            logger.warning("[模型切换]新聊天模型验证失败，保留当前模型", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="聊天模型验证失败，请检查服务商、模型名称和后端密钥配置；当前模型保持不变。",
            ) from None

        # 原子替换避免聊天请求或其他进程读取到尚未写完的配置。
        config_path = Path(MODEL_CONFIG_PATH)
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=config_path.parent, delete=False) as file:
                temporary_path = file.name
                yaml.safe_dump(config, file, allow_unicode=True, sort_keys=False)
            os.chmod(temporary_path, config_path.stat().st_mode & 0o777)
            os.replace(temporary_path, config_path)
        finally:
            if temporary_path and os.path.exists(temporary_path):
                os.unlink(temporary_path)
        logger.info(f"[模型切换]聊天模型已生效，provider={payload.chat_provider}，model={payload.chat_model}")
        return get_model_settings()


def update_rag_settings(payload: RagSettingsUpdateRequest) -> RagSettingsResponse:
    if payload.chunk_overlap >= payload.chunk_size:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="chunk_overlap 必须小于 chunk_size")

    config = load_rag_config(RAG_CONFIG_PATH)
    config["k"] = payload.k
    config["chunk_size"] = payload.chunk_size
    config["chunk_overlap"] = payload.chunk_overlap

    with open(RAG_CONFIG_PATH, "w", encoding="utf-8") as file:
        yaml.safe_dump(config, file, allow_unicode=True, sort_keys=False)
    return get_rag_settings()

"""模型设置服务，负责读取和更新模型 YAML 配置。"""
import yaml
from fastapi import HTTPException, status

from app.schemas.settings import ModelSettingsResponse, ModelSettingsUpdateRequest, RagSettingsResponse, RagSettingsUpdateRequest
from app.utils.config_loading_tool import load_model_config, load_rag_config
from app.utils.path_tool import get_abs_path

MODEL_CONFIG_PATH = get_abs_path("config/model.yaml")
RAG_CONFIG_PATH = get_abs_path("config/rag.yaml")
CHAT_PROVIDERS = {"dashscope", "deepseek", "ollama", "openai"}
EMBEDDING_PROVIDERS = {"dashscope", "ollama"}


def get_model_settings() -> ModelSettingsResponse:
    config = load_model_config(MODEL_CONFIG_PATH)
    return ModelSettingsResponse(
        chat_provider=config["chat"]["provider"],
        chat_model=config["chat"]["model_name"],
        embedding_provider=config["embedding"]["provider"],
        embedding_model=config["embedding"]["model_name"],
        providers=config["providers"],
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
    config = load_model_config(MODEL_CONFIG_PATH)
    providers = set(config["providers"].keys())
    if payload.chat_provider not in providers or payload.chat_provider not in CHAT_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的聊天模型 provider")
    if payload.embedding_provider not in providers or payload.embedding_provider not in EMBEDDING_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的 embedding provider")

    config["chat"]["provider"] = payload.chat_provider
    config["chat"]["model_name"] = payload.chat_model
    config["embedding"]["provider"] = payload.embedding_provider
    config["embedding"]["model_name"] = payload.embedding_model

    with open(MODEL_CONFIG_PATH, "w", encoding="utf-8") as file:
        yaml.safe_dump(config, file, allow_unicode=True, sort_keys=False)
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

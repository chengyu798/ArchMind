"""模型工厂。"""
from abc import ABC, abstractmethod
from typing import Optional

from langchain_community.chat_models.tongyi import BaseChatModel, ChatTongyi
from langchain_community.embeddings import DashScopeEmbeddings
from langchain_core.embeddings import Embeddings
from langchain_openai import ChatOpenAI

from app.utils.config_loading_tool import get_env_value, model_config

try:
    from langchain_ollama import ChatOllama, OllamaEmbeddings
except ImportError:
    ChatOllama = None
    OllamaEmbeddings = None


class BaseModelFactory(ABC):
    @abstractmethod
    def generator(self) -> Optional[BaseChatModel | Embeddings]:
        pass


def _require_ollama():
    if ChatOllama is None or OllamaEmbeddings is None:
        raise RuntimeError("使用 Ollama provider 需要先安装 langchain-ollama 依赖。")


class ChatModelFactory(BaseModelFactory):
    def generator(self) -> Optional[BaseChatModel | Embeddings]:
        chat_config = model_config["chat"]
        provider = chat_config["provider"]
        provider_config = model_config["providers"][provider]

        if provider == "ollama":
            _require_ollama()
            return ChatOllama(
                model=chat_config.get("model_name") or provider_config["chat_model"],
                base_url=provider_config["base_url"],
                temperature=chat_config.get("temperature", 0),
            )

        if provider == "dashscope":
            api_key = get_env_value(provider_config["api_key_env"])
            return ChatTongyi(model=chat_config["model_name"], api_key=api_key)

        api_key = get_env_value(provider_config["api_key_env"])
        return ChatOpenAI(
            model=chat_config["model_name"],
            api_key=api_key,
            base_url=provider_config["base_url"],
            temperature=chat_config.get("temperature", 0),
        )


class EmbeddingsModelFactory(BaseModelFactory):
    def generator(self) -> Optional[BaseChatModel | Embeddings]:
        embedding_config = model_config["embedding"]
        provider = embedding_config["provider"]
        provider_config = model_config["providers"][provider]

        if provider == "ollama":
            _require_ollama()
            return OllamaEmbeddings(
                model=embedding_config.get("model_name") or provider_config["embedding_model"],
                base_url=provider_config["base_url"],
            )

        if provider == "dashscope":
            api_key = get_env_value(provider_config["api_key_env"])
            return DashScopeEmbeddings(model=embedding_config["model_name"], dashscope_api_key=api_key)

        raise RuntimeError(f"暂不支持 provider {provider} 的 embedding 模型。")


chat_model = ChatModelFactory().generator()
embedding_model = EmbeddingsModelFactory().generator()

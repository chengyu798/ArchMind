"""按聊天配置缓存 Agent；每次生成读取最新配置，进行中的生成保留原实例。"""
import json
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from langchain.agents import create_agent
from langchain_core.language_models.chat_models import BaseChatModel

from app.agent.context import AgentContext
from app.agent.middleware import log_before_model, monitor_tool, report_prompt_switch
from app.agent.tools import get_weather, search_user_knowledge, search_web, search_conversation_history
from app.models.factory import ChatModelFactory
from app.utils.config_loading_tool import load_model_config
from app.utils.prompts_loading_tool import load_system_prompt

AGENT_TOOLS = [search_user_knowledge, search_web, get_weather, search_conversation_history]


@dataclass(frozen=True)
class ChatRuntime:
    model: BaseChatModel
    agent: Any


@lru_cache(maxsize=8)
def _runtime_for_config(config_json: str) -> ChatRuntime:
    model = ChatModelFactory(json.loads(config_json)).generator()
    agent = create_agent(
        model=model,
        context_schema=AgentContext,
        system_prompt=load_system_prompt(),
        tools=AGENT_TOOLS,
        middleware=[monitor_tool, log_before_model, report_prompt_switch],
    )
    return ChatRuntime(model=model, agent=agent)


def get_chat_runtime(config: dict | None = None) -> ChatRuntime:
    config = config if config is not None else load_model_config()
    provider = config["chat"]["provider"]
    # Embedding 配置不参与聊天实例的创建或切换。
    chat_config = {"chat": config["chat"], "providers": {provider: config["providers"][provider]}}
    return _runtime_for_config(json.dumps(chat_config, sort_keys=True))


def validate_chat_runtime(config: dict) -> None:
    runtime = get_chat_runtime(config)
    # 同时验证模型连接和工具参数支持；此处不会执行任何工具。
    provider = config["chat"]["provider"]
    if provider == "dashscope":
        options = {"request_timeout": 20}
    elif provider == "ollama":
        options = {}
    else:
        options = {"timeout": 20}
    runtime.model.bind_tools(AGENT_TOOLS).invoke("请只回复 OK，不要调用工具。", **options)

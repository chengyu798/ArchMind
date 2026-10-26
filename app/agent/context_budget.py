"""Local token budgeting. JSON serialization is an estimate, not provider billing."""
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any
import yaml
from tokenizers import Tokenizer
from langchain_core.messages import BaseMessage, convert_to_openai_messages
from langchain_core.utils.function_calling import convert_to_openai_tool

CONFIG_PATH = Path(__file__).resolve().parents[1] / "config/context.yaml"
TOKENIZER_PATH = Path(__file__).resolve().parents[1] / "assets/deepseek-v4-tokenizer/tokenizer.json"


class ContextCapacityError(RuntimeError):
    pass


@dataclass(frozen=True)
class ContextPolicy:
    context_window: int = 1048576
    trigger_ratio: float = .50
    target_min_ratio: float = .20
    target_ratio: float = .25
    target_max_ratio: float = .30
    output_tokens: int = 65536
    safety_tokens: int = 8192
    summary_max_tokens: int = 8192
    summary_timeout_seconds: int = 120
    lease_seconds: int = 600
    history_result_tokens: int = 4096
    supported_models: tuple[str, ...] = ("deepseek-v4-flash", "deepseek-flash", "deepseek-v4-pro")

    def __post_init__(self):
        if not 0 < self.target_min_ratio <= self.target_ratio <= self.target_max_ratio < self.trigger_ratio < 1:
            raise ValueError("上下文目标范围必须低于压缩触发线")
        if min(self.output_tokens, self.safety_tokens, self.summary_max_tokens, self.context_window) <= 0 or self.output_tokens + self.safety_tokens >= self.context_window:
            raise ValueError("上下文容量和输出预留无效")

    @property
    def input_limit(self):
        return self.context_window - self.output_tokens - self.safety_tokens


def load_context_policy() -> ContextPolicy:
    values = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
    values["supported_models"] = tuple(values["supported_models"])
    return ContextPolicy(**values)


@lru_cache(maxsize=1)
def tokenizer():
    result = Tokenizer.from_file(str(TOKENIZER_PATH))
    result.no_truncation()
    return result


@lru_cache(maxsize=512)
def _small_count(text: str) -> int:
    return len(tokenizer().encode(text, add_special_tokens=False).ids)


def count_text(text: str) -> int:
    # Do not retain large private transcripts in an LRU cache.
    return _small_count(text) if len(text) < 2048 else len(tokenizer().encode(text, add_special_tokens=False).ids)


def serialize(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def count_input(messages: list, tools: list | None = None, system: str = "") -> int:
    converted = []
    for message in messages:
        converted.append(convert_to_openai_messages(message) if isinstance(message, BaseMessage) else message)
    schemas = [convert_to_openai_tool(tool) for tool in tools or []]
    return count_text(serialize({"system": system, "messages": converted, "tools": schemas})) + 16 * (len(messages) + len(schemas) + 1)


def check_capacity(input_tokens: int, policy: ContextPolicy) -> None:
    if input_tokens > policy.input_limit:
        raise ContextCapacityError("当前输入超过会话上下文预算，已保留原始记录。请缩短本次问题或将大段资料上传为文件后重试。")


def model_name(model) -> str:
    return str(getattr(model, "model_name", getattr(model, "model", "")))


def guarded_request(request):
    policy = load_context_policy()
    if model_name(request.model) not in policy.supported_models:
        return request
    count = count_input(request.messages, request.tools, request.system_message.content if request.system_message else "")
    check_capacity(count, policy)
    return request.override(model_settings={**request.model_settings, "max_tokens": policy.output_tokens})

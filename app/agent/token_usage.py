"""Collect provider-reported usage once per model invocation, scoped to one answer."""
from threading import Lock
from typing import Any
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

_FIELDS = ("input_tokens", "output_tokens", "total_tokens")


def normalize_usage(data: Any) -> dict[str, int | None] | None:
    if not isinstance(data, dict):
        return None
    values = {}
    for field, alias in zip(_FIELDS, ("prompt_tokens", "completion_tokens", "total_tokens")):
        value = data.get(field, data.get(alias))
        values[field] = value if type(value) is int and value >= 0 else None
    if values["total_tokens"] is None and all(values[field] is not None for field in _FIELDS[:2]):
        values["total_tokens"] = values["input_tokens"] + values["output_tokens"]
    return values if any(value is not None for value in values.values()) else None


def _response_usage(response: LLMResult | None) -> dict[str, int | None] | None:
    if response is None:
        return None
    # Integrations expose the same usage in different locations. Use the first
    # authoritative record, never add those copies together.
    for generations in response.generations:
        for generation in generations:
            message = getattr(generation, "message", None)
            metadata = getattr(message, "response_metadata", {}) or {}
            info = generation.generation_info or {}
            for data in (getattr(message, "usage_metadata", None), metadata.get("token_usage"), metadata.get("usage"), info.get("token_usage"), info.get("usage")):
                if (usage := normalize_usage(data)) is not None:
                    return usage
    output = response.llm_output or {}
    return normalize_usage(output.get("token_usage")) or normalize_usage(output.get("usage"))


class TokenUsageCollector(BaseCallbackHandler):
    def __init__(self):
        self._lock = Lock()
        self._calls: dict[UUID, dict[str, int | None] | None] = {}

    def on_llm_end(self, response: LLMResult, *, run_id: UUID, **kwargs: Any) -> None:
        with self._lock:
            self._calls[run_id] = _response_usage(response)

    def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        with self._lock:
            self._calls[run_id] = _response_usage(kwargs.get("response"))

    def summary(self) -> dict[str, int | None]:
        with self._lock:
            calls = list(self._calls.values())
        # Missing usage must not silently become zero or a partial total.
        result = {
            field: sum(call[field] for call in calls) if calls and all(call is not None and call[field] is not None for call in calls) else None
            for field in _FIELDS
        }
        result.update(model_calls=len(calls), reported_calls=sum(call is not None for call in calls))
        return result


def merge_usage(*usages):
    """Preserve unknown counts when combining answer and compaction calls."""
    values = [usage for usage in usages if usage and usage.get('model_calls', 0)]
    if not values: return None
    result = {field: sum(usage[field] for usage in values) if all(usage.get(field) is not None for usage in values) else None for field in _FIELDS}
    result['model_calls'] = sum(usage.get('model_calls', 0) for usage in values)
    result['reported_calls'] = sum(usage.get('reported_calls', 0) for usage in values)
    return result

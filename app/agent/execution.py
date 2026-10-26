"""Trusted per-request state propagated through LangGraph worker contexts."""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class ChatExecution:
    session_id: int
    user_message_id: int
    sessions: Any
    lease: str
    history: list = field(default_factory=list)
    history_override: list | None = None
    prepare: Callable | None = None
    compaction_attempts: int = 0
    compaction_usage: list = field(default_factory=list)


_current = ContextVar("chat_execution", default=None)


def current_execution() -> ChatExecution | None:
    return _current.get()


@contextmanager
def bind_execution(execution: ChatExecution):
    token = _current.set(execution)
    try:
        yield execution
    finally:
        _current.reset(token)

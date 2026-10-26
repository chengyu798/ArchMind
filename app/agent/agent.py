"""用户级 Agent 服务，负责将 FastAPI 聊天请求接入 LangChain Agent。"""
from collections.abc import Generator
from typing import Any, Literal

from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage

from app.agent.context import AgentContext
from app.agent.execution import current_execution
from app.agent.input_builder import build_messages
from app.agent.runtime import get_chat_runtime
from app.agent.workflow import AgentWorkflow
from app.agent.token_usage import TokenUsageCollector
from app.utils.logger_tool import logger

AgentStreamEventType = Literal["message", "tool_call", "tool_result", "usage"]
AgentStreamEvent = dict[str, Any]


def _stringify_tool_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if text:
                    parts.append(str(text))
            else:
                parts.append(str(item))
        return "\n".join(parts)
    return str(content) if content is not None else ""


def _message_text(message: Any) -> str:
    return _stringify_tool_content(getattr(message, "content", "") or "")


def _history_messages(history: list[dict[str, str]] | None) -> list[dict[str, str]]:
    return [
        {"role": item["role"], "content": item["content"]}
        for item in history or []
        if item.get("role") in {"user", "assistant"} and item.get("content")
    ]


class UserAgentService:
    def __init__(self):
        self.workflow = AgentWorkflow(self._generate_answer_direct, self._stream_events_direct)

    def _generate_answer_direct(
        self,
        query: str,
        user_id: int,
        history: list[dict[str, str]],
        memory: str,
        report: bool,
    ) -> str:
        chunks = list(self.stream_answer(query, user_id, history, memory, report))
        return "".join(chunks)

    def generate_answer(
        self,
        query: str,
        user_id: int,
        history: list[dict[str, str]] | None = None,
        memory: str = "",
        report: bool = False,
    ) -> str:
        logger.info(f"[用户Agent]开始同步生成回答，user_id={user_id}，report={report}")
        result = self.workflow.invoke(query, user_id, history, memory, report)
        answer = result["answer"]
        logger.info(f"[用户Agent]同步回答生成完成，user_id={user_id}，answer_length={len(answer)}，steps={result.get('steps')}")
        return answer

    def stream_answer(
        self,
        query: str,
        user_id: int,
        history: list[dict[str, str]] | None = None,
        memory: str = "",
        report: bool = False,
    ) -> Generator[str, None, None]:
        for event in self.stream_events(query, user_id, history, memory, report):
            if event["type"] == "message":
                yield event["content"]

    def stream_events(
        self,
        query: str,
        user_id: int,
        history: list[dict[str, str]] | None = None,
        memory: str = "",
        report: bool = False,
    ) -> Generator[AgentStreamEvent, None, None]:
        yield from self.workflow.stream(query, user_id, history, memory, report)

    def _stream_events_direct(
        self,
        query: str,
        user_id: int,
        history: list[dict[str, str]] | None = None,
        memory: str = "",
        report: bool = False,
    ) -> Generator[AgentStreamEvent, None, None]:
        logger.info(f"[用户Agent]开始流式生成事件，user_id={user_id}，report={report}")
        messages = build_messages(history, query, memory)
        input_dict = {"messages": messages}

        message_chunk_count = 0
        tool_event_count = 0
        emitted_answer = ""
        agent = get_chat_runtime().agent
        usage = TokenUsageCollector()
        execution = current_execution()
        try:
            for chunk in agent.stream(
                input_dict,
                stream_mode=["messages", "updates", "custom"],
                config={"callbacks": [usage]},
                version="v2",
                context=AgentContext(user_id=user_id, report=report, session_id=execution.session_id if execution else None, user_message_id=execution.user_message_id if execution else None),
            ):
                chunk_type = chunk.get("type")
                if chunk_type == "custom":
                    yield chunk["data"]
                    continue
                if chunk_type == "messages":
                    token, _metadata = chunk["data"]
                    if not isinstance(token, AIMessageChunk):
                        continue

                    for tool_call_chunk in token.tool_call_chunks or []:
                        tool_name = tool_call_chunk.get("name")
                        if tool_name:
                            tool_event_count += 1
                            yield {"type": "tool_call", "name": tool_name, "args": tool_call_chunk.get("args") or ""}

                    content = _message_text(token)
                    if content:
                        emitted_answer += content
                        message_chunk_count += 1
                        yield {"type": "message", "content": content}
                    continue

                if chunk_type != "updates":
                    continue

                for source, update in chunk.get("data", {}).items():
                    if source not in {"model", "tools"}:
                        continue
                    messages = update.get("messages") or []
                    if not messages:
                        continue
                    latest_message = messages[-1]
                    if isinstance(latest_message, AIMessage):
                        for tool_call in latest_message.tool_calls or []:
                            tool_event_count += 1
                            yield {
                                "type": "tool_call",
                                "name": tool_call.get("name", "未知工具"),
                                "args": tool_call.get("args", {}),
                            }

                        content = _message_text(latest_message)
                        if content and content != emitted_answer:
                            delta = content.removeprefix(emitted_answer) if content.startswith(emitted_answer) else content
                            if delta:
                                emitted_answer += delta
                                message_chunk_count += 1
                                yield {"type": "message", "content": delta}
                    elif isinstance(latest_message, ToolMessage):
                        tool_event_count += 1
                        yield {
                            "type": "tool_result",
                            "name": latest_message.name or "工具结果",
                            "content": _stringify_tool_content(latest_message.content),
                        }
        except Exception:
            yield {"type": "usage", "content": "", "usage": usage.summary()}
            raise
        yield {"type": "usage", "content": "", "usage": usage.summary()}

        logger.info(
            f"[用户Agent]流式事件生成完成，user_id={user_id}，message_chunks={message_chunk_count}，tool_events={tool_event_count}"
        )

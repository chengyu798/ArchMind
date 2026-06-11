"""用户级 Agent 服务，负责将 FastAPI 聊天请求接入 LangChain Agent。"""
from collections.abc import Generator
from typing import Any, Literal

from langchain.agents import create_agent
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage

from app.agent.middleware import log_before_model, monitor_tool, report_prompt_switch
from app.agent.tools import get_weather, search_user_knowledge, search_web
from app.agent.workflow import AgentWorkflow
from app.models.factory import chat_model
from app.utils.logger_tool import logger
from app.utils.prompts_loading_tool import load_system_prompt

AgentStreamEventType = Literal["message", "tool_call", "tool_result"]
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
        self.agent = create_agent(
            model=chat_model,
            system_prompt=load_system_prompt(),
            tools=[search_user_knowledge, search_web, get_weather],
            middleware=[monitor_tool, log_before_model, report_prompt_switch],
        )
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
        messages = _history_messages(history)
        memory_context = f"\n长期记忆：\n{memory}\n" if memory else ""
        messages.append(
            {
                "role": "user",
                "content": f"当前登录用户ID：{user_id}{memory_context}\n用户问题：{query}\n如果问题需要参考用户文件，请调用 search_user_knowledge 工具，并传入这里提供的当前登录用户ID；不要尝试通过工具获取用户ID。若知识库没有检索到相关内容，或用户明确要求查询公开网络信息，请调用 search_web，并将网络搜索结果与用户问题结合后回答。",
            }
        )
        input_dict = {"messages": messages}

        message_chunk_count = 0
        tool_event_count = 0
        emitted_answer = ""
        for chunk in self.agent.stream(
            input_dict,
            stream_mode=["messages", "updates"],
            version="v2",
            context={"report": report, "user_id": user_id},
        ):
            chunk_type = chunk.get("type")
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

        logger.info(
            f"[用户Agent]流式事件生成完成，user_id={user_id}，message_chunks={message_chunk_count}，tool_events={tool_event_count}"
        )

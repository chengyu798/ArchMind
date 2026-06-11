"""LangGraph Agent 状态流，显式编排上下文准备、生成和收尾步骤。"""
from typing import Callable, Generator, TypedDict

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from app.utils.logger_tool import logger


class AgentWorkflowState(TypedDict):
    query: str
    user_id: int
    history: list[dict[str, str]]
    memory: str
    report: bool
    prepared_query: str
    answer: str
    steps: list[str]


GenerateAnswer = Callable[[str, int, list[dict[str, str]], str, bool], str]
StreamEvents = Callable[[str, int, list[dict[str, str]], str, bool], Generator[dict, None, None]]


def _append_step(state: AgentWorkflowState, step: str) -> list[str]:
    return [*state.get("steps", []), step]


class AgentWorkflow:
    def __init__(self, generate_answer: GenerateAnswer, stream_events: StreamEvents | None = None):
        self.generate_answer = generate_answer
        self.stream_events_callback = stream_events
        graph = StateGraph(AgentWorkflowState)
        graph.add_node("prepare_context", self.prepare_context)
        graph.add_node("generate_answer", self.generate_agent_answer)
        graph.add_node("finalize", self.finalize)
        graph.add_edge(START, "prepare_context")
        graph.add_edge("prepare_context", "generate_answer")
        graph.add_edge("generate_answer", "finalize")
        graph.add_edge("finalize", END)
        self.graph = graph.compile()

    def prepare_context(self, state: AgentWorkflowState) -> dict:
        logger.info(f"[Agent状态流]prepare_context，user_id={state['user_id']}，report={state.get('report', False)}")
        return {"prepared_query": state["query"].strip(), "steps": _append_step(state, "prepare_context")}

    def generate_agent_answer(self, state: AgentWorkflowState) -> dict:
        logger.info(f"[Agent状态流]generate_answer，user_id={state['user_id']}")
        answer = self.generate_answer(
            state["prepared_query"],
            state["user_id"],
            state.get("history") or [],
            state.get("memory") or "",
            state.get("report", False),
        )
        return {"answer": answer, "steps": _append_step(state, "generate_answer")}

    def stream_agent_answer(self, state: AgentWorkflowState) -> dict:
        if self.stream_events_callback is None:
            return self.generate_agent_answer(state)

        writer = get_stream_writer()
        answer_parts: list[str] = []
        for event in self.stream_events_callback(
            state["prepared_query"],
            state["user_id"],
            state.get("history") or [],
            state.get("memory") or "",
            state.get("report", False),
        ):
            if event.get("type") == "message":
                answer_parts.append(event.get("content", ""))
            writer(event)
        return {"answer": "".join(answer_parts), "steps": _append_step(state, "generate_answer")}

    def finalize(self, state: AgentWorkflowState) -> dict:
        logger.info(f"[Agent状态流]finalize，user_id={state['user_id']}，answer_length={len(state.get('answer') or '')}")
        return {"answer": (state.get("answer") or "").strip(), "steps": _append_step(state, "finalize")}

    def _initial_state(
        self,
        query: str,
        user_id: int,
        history: list[dict[str, str]] | None = None,
        memory: str = "",
        report: bool = False,
    ) -> AgentWorkflowState:
        return {
            "query": query,
            "user_id": user_id,
            "history": history or [],
            "memory": memory,
            "report": report,
            "prepared_query": "",
            "answer": "",
            "steps": [],
        }

    def invoke(
        self,
        query: str,
        user_id: int,
        history: list[dict[str, str]] | None = None,
        memory: str = "",
        report: bool = False,
    ) -> AgentWorkflowState:
        return self.graph.invoke(self._initial_state(query, user_id, history, memory, report))

    def stream(
        self,
        query: str,
        user_id: int,
        history: list[dict[str, str]] | None = None,
        memory: str = "",
        report: bool = False,
    ) -> Generator[dict, None, None]:
        graph = StateGraph(AgentWorkflowState)
        graph.add_node("prepare_context", self.prepare_context)
        graph.add_node("generate_answer", self.stream_agent_answer)
        graph.add_node("finalize", self.finalize)
        graph.add_edge(START, "prepare_context")
        graph.add_edge("prepare_context", "generate_answer")
        graph.add_edge("generate_answer", "finalize")
        graph.add_edge("finalize", END)
        compiled = graph.compile()
        yield {"type": "workflow_step", "name": "prepare_context"}
        for event in compiled.stream(self._initial_state(query, user_id, history, memory, report), stream_mode="custom"):
            yield event
        yield {"type": "workflow_step", "name": "finalize"}

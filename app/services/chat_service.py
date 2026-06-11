"""聊天服务层，负责会话管理、消息保存、RAG 回复生成和流式响应数据组织。"""
import json
from collections.abc import Generator

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.agent.agent import UserAgentService
from app.db.database import SessionLocal
from app.db.models import ChatSession, Message, User
from app.schemas.chat import MessageCreateRequest, SendMessageResponse, SessionCreateRequest, SessionUpdateRequest
from app.services.memory_service import extract_memories_from_message, format_user_memories
from app.utils.logger_tool import logger

user_agent_service = UserAgentService()
EMPTY_ASSISTANT_FALLBACK = "本次没有生成有效回复，请换一种问法后重试。"
RECENT_HISTORY_MESSAGE_LIMIT = 8
RECENT_HISTORY_CONTENT_LIMIT = 1200


def _truncate_history_content(content: str) -> str:
    content = content.strip()
    if len(content) <= RECENT_HISTORY_CONTENT_LIMIT:
        return content
    return f"{content[:RECENT_HISTORY_CONTENT_LIMIT]}…"


def build_recent_history(messages: list[Message]) -> list[dict[str, str]]:
    history: list[dict[str, str]] = []
    for message in sorted(messages, key=lambda item: item.id):
        if message.role not in {"user", "assistant"}:
            continue
        content = _truncate_history_content(message.content)
        if content:
            history.append({"role": message.role, "content": content})
    return history[-RECENT_HISTORY_MESSAGE_LIMIT:]


def get_owned_session(db: Session, session_id: int, user_id: int) -> ChatSession:
    session = db.scalar(
        select(ChatSession)
        .options(selectinload(ChatSession.messages))
        .where(ChatSession.id == session_id, ChatSession.user_id == user_id)
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    return session


def create_user_session(db: Session, current_user: User, payload: SessionCreateRequest) -> ChatSession:
    logger.info(f"[会话管理]创建会话，user_id={current_user.id}，title={payload.title}")
    session = ChatSession(user_id=current_user.id, title=payload.title)
    db.add(session)
    db.commit()
    db.refresh(session)
    logger.info(f"[会话管理]会话创建成功，user_id={current_user.id}，session_id={session.id}")
    return session


def list_user_sessions(db: Session, current_user: User) -> list[ChatSession]:
    logger.info(f"[会话管理]查询会话列表，user_id={current_user.id}")
    return db.scalars(
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.updated_at.desc(), ChatSession.id.desc())
    ).all()


def get_user_session(db: Session, current_user: User, session_id: int) -> ChatSession:
    logger.info(f"[会话管理]查询会话详情，user_id={current_user.id}，session_id={session_id}")
    return get_owned_session(db, session_id, current_user.id)


def update_user_session(db: Session, current_user: User, session_id: int, payload: SessionUpdateRequest) -> ChatSession:
    session = get_owned_session(db, session_id, current_user.id)
    session.title = payload.title.strip()
    db.add(session)
    db.commit()
    db.refresh(session)
    logger.info(f"[会话管理]更新会话标题成功，user_id={current_user.id}，session_id={session_id}")
    return session


def delete_user_session(db: Session, current_user: User, session_id: int) -> None:
    session = get_owned_session(db, session_id, current_user.id)
    db.delete(session)
    db.commit()
    logger.info(f"[会话管理]删除会话成功，user_id={current_user.id}，session_id={session_id}")


def create_user_message(db: Session, current_user: User, session_id: int, payload: MessageCreateRequest) -> SendMessageResponse:
    session = get_owned_session(db, session_id, current_user.id)
    logger.info(f"[聊天RAG]收到用户消息，user_id={current_user.id}，session_id={session_id}，content_length={len(payload.content)}")

    history = build_recent_history(session.messages)
    user_message = Message(session_id=session.id, role="user", content=payload.content)
    db.add(user_message)
    db.commit()
    db.refresh(user_message)
    extract_memories_from_message(db, current_user.id, payload.content)
    long_term_memory = format_user_memories(db, current_user.id)
    logger.info(f"[聊天RAG]用户消息保存成功，message_id={user_message.id}")

    try:
        assistant_content = user_agent_service.generate_answer(payload.content, current_user.id, history, memory=long_term_memory).strip() or EMPTY_ASSISTANT_FALLBACK
    except Exception as e:
        logger.error(f"[聊天RAG]RAG 回复生成失败，user_id={current_user.id}，session_id={session_id}，原因：{str(e)}", exc_info=True)
        assistant_content = "生成回复时出现错误，请稍后重试。"

    assistant_message = Message(session_id=session.id, role="assistant", content=assistant_content)
    db.add(assistant_message)
    db.commit()
    db.refresh(assistant_message)
    db.refresh(session)
    logger.info(f"[聊天RAG]助手消息保存成功，message_id={assistant_message.id}，session_id={session_id}")

    return SendMessageResponse(session=session, messages=[user_message, assistant_message])


def save_stream_user_message(db: Session, current_user: User, session_id: int, payload: MessageCreateRequest) -> tuple[ChatSession, list[dict[str, str]], str]:
    session = get_owned_session(db, session_id, current_user.id)
    logger.info(f"[流式聊天]收到用户消息，user_id={current_user.id}，session_id={session_id}，content_length={len(payload.content)}")

    history = build_recent_history(session.messages)
    user_message = Message(session_id=session.id, role="user", content=payload.content)
    db.add(user_message)
    db.commit()
    db.refresh(user_message)
    extract_memories_from_message(db, current_user.id, payload.content)
    long_term_memory = format_user_memories(db, current_user.id)
    logger.info(f"[流式聊天]用户消息保存成功，message_id={user_message.id}")
    return session, history, long_term_memory


def format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def stream_assistant_message(
    session_id: int,
    user_id: int,
    query: str,
    history: list[dict[str, str]] | None = None,
    memory: str = "",
) -> Generator[str, None, None]:
    logger.info(f"[流式聊天]开始流式响应，user_id={user_id}，session_id={session_id}")
    assistant_chunks: list[str] = []

    try:
        yield format_sse("start", {"session_id": session_id})
        for event in user_agent_service.stream_events(query, user_id, history, memory=memory):
            event_type = event.get("type")
            if event_type == "message":
                content = event.get("content", "")
                assistant_chunks.append(content)
                yield format_sse("message", {"content": content})
            elif event_type == "workflow_step":
                yield format_sse("workflow_step", {"name": event.get("name")})
            elif event_type == "tool_call":
                yield format_sse("tool_call", {"name": event.get("name"), "args": event.get("args")})
            elif event_type == "tool_result":
                yield format_sse("tool_result", {"name": event.get("name"), "content": event.get("content")})

        assistant_content = "".join(assistant_chunks).strip()
        if not assistant_content:
            assistant_content = EMPTY_ASSISTANT_FALLBACK
            yield format_sse("message", {"content": assistant_content})
        with SessionLocal() as db:
            session = get_owned_session(db, session_id, user_id)
            assistant_message = Message(session_id=session.id, role="assistant", content=assistant_content)
            db.add(assistant_message)
            db.commit()
            db.refresh(assistant_message)
            logger.info(f"[流式聊天]助手消息保存成功，message_id={assistant_message.id}，session_id={session_id}")
            yield format_sse("done", {"message_id": assistant_message.id})
    except Exception as e:
        logger.error(f"[流式聊天]流式响应失败，user_id={user_id}，session_id={session_id}，原因：{str(e)}", exc_info=True)
        error_content = "生成回复时出现错误，请稍后重试。"
        with SessionLocal() as db:
            session = get_owned_session(db, session_id, user_id)
            assistant_message = Message(session_id=session.id, role="assistant", content=error_content)
            db.add(assistant_message)
            db.commit()
            db.refresh(assistant_message)
        yield format_sse("error", {"content": error_content})

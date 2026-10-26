"""聊天服务层，负责会话管理、消息保存、RAG 回复生成和流式响应数据组织。"""
import json
from collections.abc import Generator

from fastapi import HTTPException, status
from sqlalchemy import select, delete
from sqlalchemy.orm import Session, selectinload

from app.agent.agent import UserAgentService
from app.db.database import SessionLocal
from app.db.models import ChatSession, Message, User, SessionContextSummary, ChatToolRecord
from app.agent.execution import ChatExecution, bind_execution
from app.agent.context_budget import ContextCapacityError
from app.agent.token_usage import merge_usage
from app.services.context_service import acquire_lease, release_lease, prepare_context, status_view
from app.schemas.chat import MessageCreateRequest, SendMessageResponse, SessionCreateRequest, SessionUpdateRequest
from app.services.memory_service import extract_memories_from_message, format_user_memories
from app.utils.logger_tool import logger

user_agent_service = UserAgentService()
EMPTY_ASSISTANT_FALLBACK = "本次没有生成有效回复，请换一种问法后重试。"
def build_recent_history(messages: list[Message]) -> list[dict[str, str]]:
    return [{"role": item.role, "content": item.content} for item in sorted(messages, key=lambda item: item.id) if item.role in {"user", "assistant"} and item.content.strip()]


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
    from datetime import datetime, UTC
    if session.context_lease and session.context_lease_until and session.context_lease_until > datetime.now(UTC).replace(tzinfo=None):
        raise HTTPException(409, "该会话正在生成回复，请完成后再删除。")
    db.execute(delete(ChatToolRecord).where(ChatToolRecord.session_id == session_id, ChatToolRecord.user_id == current_user.id))
    db.execute(delete(SessionContextSummary).where(SessionContextSummary.session_id == session_id, SessionContextSummary.user_id == current_user.id))
    db.delete(session)
    db.commit()
    logger.info(f"[会话管理]删除会话成功，user_id={current_user.id}，session_id={session_id}")


def save_stream_user_message(db: Session, current_user: User, session_id: int, payload: MessageCreateRequest):
    session = get_owned_session(db, session_id, current_user.id)
    lease = acquire_lease(db, current_user.id, session_id)
    try:
        history = build_recent_history(session.messages)
        user_message = Message(session_id=session.id, role="user", content=payload.content)
        db.add(user_message); db.commit(); db.refresh(user_message)
        extract_memories_from_message(db, current_user.id, payload.content)
        memory = format_user_memories(db, current_user.id)
        return session, history, memory, user_message.id, lease
    except BaseException:
        db.rollback(); release_lease(db, session_id, lease); raise


def create_user_message(db: Session, current_user: User, session_id: int, payload: MessageCreateRequest) -> SendMessageResponse:
    session, history, memory, user_message_id, lease = save_stream_user_message(db, current_user, session_id, payload)
    events = list(_assistant_events(session_id, current_user.id, payload.content, memory, user_message_id, lease))
    final = next(event for event in reversed(events) if event['type'] in {'done', 'error'})
    db.expire_all()
    return SendMessageResponse(session=db.get(ChatSession, session_id), messages=[db.get(Message, user_message_id), db.get(Message, final['message_id'])])


def format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


def _assistant_events(session_id, user_id, query, memory, user_message_id, lease):
    execution = ChatExecution(session_id, user_message_id, SessionLocal, lease)
    answer_usage = None; content_parts = []; failed = False
    yield {"type": "start", "session_id": session_id}
    try:
        yield {"type": "context_status", "stage": "preparing"}
        with SessionLocal() as db:
            history, usage, warning = prepare_context(db, user_id, session_id, user_message_id, query, memory, lease)
        if usage or warning: execution.compaction_attempts = 1
        if usage: execution.compaction_usage.append(usage)
        execution.history = history
        def prepare(tail, tools, system):
            with SessionLocal() as db:
                return prepare_context(db, user_id, session_id, user_message_id, query, memory, lease, tail, tools, system)
        execution.prepare = prepare
        yield {"type": "context_status", "stage": "ready", "warning": warning}
        with bind_execution(execution):
            for event in user_agent_service.stream_events(query, user_id, history, memory=memory):
                if event.get('type') == 'usage': answer_usage = event.get('usage')
                else:
                    if event.get('type') == 'message': content_parts.append(event.get('content', ''))
                    yield event
        content = ''.join(content_parts).strip() or EMPTY_ASSISTANT_FALLBACK
        if not content_parts: yield {'type': 'message', 'content': content}
    except Exception as error:
        failed = True
        logger.error("[聊天]上下文准备或回答生成失败", exc_info=True)
        content = str(error) if isinstance(error, ContextCapacityError) else '生成回复时出现错误，请稍后重试。'
    finally:
        # Only the lease owner may persist an answer. A stale worker must not
        # overwrite a newer turn after a lease expiry/recovery.
        try:
            compaction_usage = merge_usage(*execution.compaction_usage)
            total = merge_usage(answer_usage, compaction_usage)
            with SessionLocal() as db:
                from app.services.context_service import renew_lease
                renew_lease(db, user_id, session_id, lease)
                session = get_owned_session(db, session_id, user_id)
                assistant = Message(session_id=session_id, role='assistant', content=content if 'content' in locals() else '回复已中断，请重试。', token_usage=total, usage_breakdown={'answer': answer_usage, 'compaction': compaction_usage})
                db.add(assistant); db.commit(); db.refresh(assistant)
                final_id = assistant.id
                context = status_view(db, user_id, session_id)
        finally:
            with SessionLocal() as db: release_lease(db, session_id, lease)
    context['processing'] = False
    yield {'type': 'error' if failed else 'done', 'message_id': final_id, **({'content': content} if failed else {}), 'token_usage': total, 'usage_breakdown': {'answer': answer_usage, 'compaction': compaction_usage}, 'context': context}


def stream_assistant_message(session_id: int, user_id: int, query: str, history=None, memory: str = '', user_message_id=None, lease=None):
    from contextvars import copy_context
    context = copy_context()
    iterator = _assistant_events(session_id, user_id, query, memory, user_message_id, lease)
    try:
        while True:
            try: event = context.run(next, iterator)
            except StopIteration: break
            yield format_sse(event['type'], {key: value for key, value in event.items() if key != 'type'})
    finally:
        context.run(iterator.close)
        if lease:
            with SessionLocal() as db: release_lease(db, session_id, lease)

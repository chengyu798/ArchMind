"""聊天路由模块，提供会话管理、同步消息和流式消息接口。"""
from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db.database import get_db
from app.schemas.chat import MessageCreateRequest, SendMessageResponse, SessionCreateRequest, SessionDetailResponse, SessionResponse, SessionUpdateRequest
from app.services.chat_service import (
    create_user_message,
    create_user_session,
    delete_user_session,
    get_user_session,
    list_user_sessions,
    save_stream_user_message,
    stream_assistant_message,
    update_user_session,
)

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(payload: SessionCreateRequest, current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    return create_user_session(db, current_user, payload)


@router.get("/sessions", response_model=list[SessionResponse])
def list_sessions(current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    return list_user_sessions(db, current_user)


@router.get("/sessions/{session_id}", response_model=SessionDetailResponse)
def get_session(session_id: int, current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    return get_user_session(db, current_user, session_id)


@router.patch("/sessions/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: int,
    payload: SessionUpdateRequest,
    current_user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    return update_user_session(db, current_user, session_id, payload)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: int, current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    delete_user_session(db, current_user, session_id)


@router.post("/sessions/{session_id}/messages", response_model=SendMessageResponse, status_code=status.HTTP_201_CREATED)
def create_message(
    session_id: int,
    payload: MessageCreateRequest,
    current_user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    return create_user_message(db, current_user, session_id, payload)


@router.post("/sessions/{session_id}/messages/stream")
def stream_message(
    session_id: int,
    payload: MessageCreateRequest,
    current_user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    session, history, memory = save_stream_user_message(db, current_user, session_id, payload)
    return StreamingResponse(
        stream_assistant_message(session.id, current_user.id, payload.content, history, memory),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )

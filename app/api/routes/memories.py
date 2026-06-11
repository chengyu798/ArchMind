"""长期记忆路由，提供当前用户记忆的查看、编辑和删除。"""
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db.database import get_db
from app.schemas.memory import MemoryCreateRequest, MemoryResponse, MemoryUpdateRequest
from app.services.memory_service import create_user_memory, delete_user_memory, list_user_memories, update_user_memory

router = APIRouter(prefix="/memories", tags=["memories"])


@router.get("", response_model=list[MemoryResponse])
def list_memories(current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    return list_user_memories(db, current_user.id, limit=100)


@router.post("", response_model=MemoryResponse, status_code=status.HTTP_201_CREATED)
def create_memory(
    payload: MemoryCreateRequest,
    current_user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    return create_user_memory(db, current_user.id, payload.memory_type, payload.content)


@router.patch("/{memory_id}", response_model=MemoryResponse)
def update_memory(
    memory_id: int,
    payload: MemoryUpdateRequest,
    current_user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    return update_user_memory(db, current_user.id, memory_id, payload.memory_type, payload.content)


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memory(memory_id: int, current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    delete_user_memory(db, current_user.id, memory_id)

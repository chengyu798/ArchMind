"""用户长期记忆服务，负责保存偏好、关注点和历史行为摘要。"""
import re

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import UserMemory
from app.utils.logger_tool import logger

MEMORY_LIMIT = 8
MAX_MEMORY_CONTENT_LENGTH = 180
ALLOWED_MEMORY_TYPES = {"preference", "focus", "profile", "constraint"}

PREFERENCE_PATTERNS = [
    re.compile(r"(?:我喜欢|我偏好|我希望|以后|后续|回答时|生成时|展示时)([^。！？\n]{2,80})"),
    re.compile(r"(?:不要|别|不希望)([^。！？\n]{2,80})"),
]
FOCUS_PATTERNS = [
    re.compile(r"(?:我正在|现在在|重点关注|优先|主要想)([^。！？\n]{2,80})"),
]


def _normalize_memory(content: str) -> str:
    return re.sub(r"\s+", " ", content).strip(" ，,。；;：:")[:MAX_MEMORY_CONTENT_LENGTH]


def list_user_memories(db: Session, user_id: int, limit: int = MEMORY_LIMIT) -> list[UserMemory]:
    return db.scalars(
        select(UserMemory)
        .where(UserMemory.user_id == user_id)
        .order_by(UserMemory.weight.desc(), UserMemory.updated_at.desc(), UserMemory.id.desc())
        .limit(limit)
    ).all()


def format_user_memories(db: Session, user_id: int) -> str:
    memories = list_user_memories(db, user_id)
    if not memories:
        return ""
    lines = [f"- [{memory.memory_type}] {memory.content}" for memory in memories]
    return "\n".join(lines)


def upsert_user_memory(db: Session, user_id: int, memory_type: str, content: str) -> UserMemory | None:
    memory_type = _normalize_memory(memory_type).lower()
    if memory_type not in ALLOWED_MEMORY_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的记忆类型")
    normalized = _normalize_memory(content)
    if len(normalized) < 2:
        return None

    memory = db.scalar(
        select(UserMemory).where(
            UserMemory.user_id == user_id,
            UserMemory.memory_type == memory_type,
            UserMemory.content == normalized,
        )
    )
    if memory:
        memory.weight += 1
    else:
        memory = UserMemory(user_id=user_id, memory_type=memory_type, content=normalized)
    db.add(memory)
    db.commit()
    db.refresh(memory)
    return memory


def create_user_memory(db: Session, user_id: int, memory_type: str, content: str) -> UserMemory:
    memory = upsert_user_memory(db, user_id, memory_type, content)
    if memory is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="记忆内容不能为空")
    logger.info(f"[用户记忆]手动创建长期记忆，user_id={user_id}，memory_id={memory.id}")
    return memory


def get_owned_memory(db: Session, user_id: int, memory_id: int) -> UserMemory:
    memory = db.scalar(select(UserMemory).where(UserMemory.id == memory_id, UserMemory.user_id == user_id))
    if memory is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记忆不存在")
    return memory


def update_user_memory(db: Session, user_id: int, memory_id: int, memory_type: str, content: str) -> UserMemory:
    memory = get_owned_memory(db, user_id, memory_id)
    memory.memory_type = _normalize_memory(memory_type)[:32]
    memory.content = _normalize_memory(content)
    db.add(memory)
    db.commit()
    db.refresh(memory)
    return memory


def delete_user_memory(db: Session, user_id: int, memory_id: int) -> None:
    memory = get_owned_memory(db, user_id, memory_id)
    db.delete(memory)
    db.commit()


def extract_memories_from_message(db: Session, user_id: int, content: str) -> None:
    extracted = 0
    for pattern in PREFERENCE_PATTERNS:
        for match in pattern.finditer(content):
            if upsert_user_memory(db, user_id, "preference", match.group(0)):
                extracted += 1
    for pattern in FOCUS_PATTERNS:
        for match in pattern.finditer(content):
            if upsert_user_memory(db, user_id, "focus", match.group(0)):
                extracted += 1
    if extracted:
        logger.info(f"[用户记忆]抽取长期记忆，user_id={user_id}，count={extracted}")

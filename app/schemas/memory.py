"""长期记忆接口模型。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

ALLOWED_MEMORY_TYPES = {"preference", "focus", "profile", "constraint"}


class MemoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    memory_type: str
    content: str
    weight: int
    created_at: datetime
    updated_at: datetime


class MemoryCreateRequest(BaseModel):
    memory_type: str = Field(min_length=1, max_length=32)
    content: str = Field(min_length=1, max_length=180)

    @field_validator("memory_type")
    @classmethod
    def validate_memory_type(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in ALLOWED_MEMORY_TYPES:
            raise ValueError("不支持的记忆类型")
        return normalized


class MemoryUpdateRequest(BaseModel):
    memory_type: str = Field(min_length=1, max_length=32)
    content: str = Field(min_length=1, max_length=180)

    @field_validator("memory_type")
    @classmethod
    def validate_memory_type(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in ALLOWED_MEMORY_TYPES:
            raise ValueError("不支持的记忆类型")
        return normalized

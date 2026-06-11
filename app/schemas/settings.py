"""模型设置接口模型。"""
from typing import Any

from pydantic import BaseModel, Field


class RagSettingsResponse(BaseModel):
    k: int
    chunk_size: int
    chunk_overlap: int
    separators: list[str]


class RagSettingsUpdateRequest(BaseModel):
    k: int = Field(ge=1, le=20)
    chunk_size: int = Field(ge=100, le=3000)
    chunk_overlap: int = Field(ge=0, le=1000)


class ModelSettingsResponse(BaseModel):
    chat_provider: str
    chat_model: str
    embedding_provider: str
    embedding_model: str
    providers: dict[str, dict[str, Any]]


class ModelSettingsUpdateRequest(BaseModel):
    chat_provider: str = Field(min_length=1)
    chat_model: str = Field(min_length=1)
    embedding_provider: str = Field(min_length=1)
    embedding_model: str = Field(min_length=1)

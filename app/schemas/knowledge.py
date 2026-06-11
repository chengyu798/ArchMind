"""知识检索接口的 Pydantic 模型，定义用户级向量检索请求和响应结构。"""
from typing import Any

from pydantic import BaseModel, Field


class KnowledgeSearchRequest(BaseModel):
    query: str = Field(min_length=1)
    k: int = Field(default=3, ge=1, le=20)


class KnowledgeSearchResult(BaseModel):
    content: str
    metadata: dict[str, Any]


class KnowledgeSearchResponse(BaseModel):
    results: list[KnowledgeSearchResult]


class SourceLookupResponse(BaseModel):
    content: str
    metadata: dict[str, Any]

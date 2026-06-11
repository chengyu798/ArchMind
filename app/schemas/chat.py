"""聊天接口的 Pydantic 模型，定义会话创建、消息写入和历史查询响应结构。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SessionCreateRequest(BaseModel):
    title: str = Field(default="新会话", min_length=1, max_length=255)


class SessionUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class MessageCreateRequest(BaseModel):
    content: str = Field(min_length=1)


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    role: str
    content: str
    created_at: datetime


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    title: str
    created_at: datetime
    updated_at: datetime


class SessionDetailResponse(SessionResponse):
    messages: list[MessageResponse]


class SendMessageResponse(BaseModel):
    session: SessionResponse
    messages: list[MessageResponse]

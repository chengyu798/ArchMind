"""认证接口的 Pydantic 模型，定义注册、登录、令牌和用户响应结构。"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class UserRegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    nickname: str = Field(min_length=1, max_length=64)
    email: Optional[str] = None

    @model_validator(mode="after")
    def validate_optional_email(self):
        if self.email is not None and self.email.strip() == "":
            self.email = None
        if self.email is not None:
            try:
                EmailStr.validate(self.email)
            except Exception:
                raise ValueError("邮箱格式不正确")
        return self


class UserLoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    nickname: str
    email: Optional[str]
    is_admin: bool
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

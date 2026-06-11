"""认证路由模块，提供用户注册、登录和获取当前用户信息接口。"""
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db.database import get_db
from app.schemas.auth import TokenResponse, UserLoginRequest, UserRegisterRequest, UserResponse
from app.services.auth_service import login_user, register_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(payload: UserRegisterRequest, db: Annotated[Session, Depends(get_db)]):
    return register_user(db, payload)


@router.post("/login", response_model=TokenResponse)
def login(payload: UserLoginRequest, db: Annotated[Session, Depends(get_db)]):
    return login_user(db, payload)


@router.get("/me", response_model=UserResponse)
def get_me(current_user: CurrentUser):
    return current_user

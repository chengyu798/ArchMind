"""认证服务层，负责用户注册、登录校验和访问令牌签发。"""
from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth.jwt import create_access_token
from app.auth.password import hash_password, verify_password
from app.db.models import User
from app.schemas.auth import TokenResponse, UserLoginRequest, UserRegisterRequest
from app.utils.logger_tool import logger


def register_user(db: Session, payload: UserRegisterRequest) -> User:
    existing_user = db.scalar(
        select(User).where(or_(User.username == payload.username, User.email == payload.email))
        if payload.email
        else select(User).where(User.username == payload.username)
    )
    if existing_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名或邮箱已存在")

    user = User(
        username=payload.username,
        nickname=payload.nickname,
        email=payload.email,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info(f"[用户认证]用户注册成功，user_id={user.id}，username={user.username}")
    return user


def login_user(db: Session, payload: UserLoginRequest) -> TokenResponse:
    user = db.scalar(select(User).where(User.username == payload.username))
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    access_token = create_access_token(str(user.id))
    logger.info(f"[用户认证]用户登录成功，user_id={user.id}，username={user.username}")
    return TokenResponse(access_token=access_token, user=user)

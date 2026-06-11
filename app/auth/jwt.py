"""JWT 工具模块，负责访问令牌的创建和解析。"""
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt

from app.utils.config_loading_tool import auth_config, get_env_value

ALGORITHM = auth_config["algorithm"]
ACCESS_TOKEN_EXPIRE_MINUTES = auth_config["access_token_expire_minutes"]
SECRET_KEY = get_env_value(auth_config["jwt_secret_env"])


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    payload: dict[str, Any] = {"sub": subject, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as e:
        raise ValueError("无效的访问令牌") from e

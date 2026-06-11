"""数据库连接与会话管理模块，负责创建 SQLite 引擎和 FastAPI 数据库依赖。"""
import os
from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.utils.config_loading_tool import database_config
from app.utils.path_tool import get_abs_path


def _build_database_url() -> str:
    database_url = database_config["database_url"]
    if database_url.startswith("sqlite:///") and not database_url.startswith("sqlite:////"):
        relative_path = database_url.removeprefix("sqlite:///")
        sqlite_path = get_abs_path(relative_path)
        os.makedirs(os.path.dirname(sqlite_path), exist_ok=True)
        return f"sqlite:///{sqlite_path}"
    return database_url


DATABASE_URL = _build_database_url()
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_user_columns() -> None:
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    column_names = {column["name"] for column in inspector.get_columns("users")}
    with engine.begin() as connection:
        if "nickname" not in column_names:
            connection.execute(text("ALTER TABLE users ADD COLUMN nickname VARCHAR(64) NOT NULL DEFAULT ''"))
            connection.execute(text("UPDATE users SET nickname = username WHERE nickname = ''"))
        if "is_admin" not in column_names:
            connection.execute(text("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"))


def _ensure_uploaded_file_columns() -> None:
    inspector = inspect(engine)
    if "uploaded_files" not in inspector.get_table_names():
        return

    column_names = {column["name"] for column in inspector.get_columns("uploaded_files")}
    with engine.begin() as connection:
        if "file_size" not in column_names:
            connection.execute(text("ALTER TABLE uploaded_files ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0"))
        if "md5" not in column_names:
            connection.execute(text("ALTER TABLE uploaded_files ADD COLUMN md5 VARCHAR(32) NOT NULL DEFAULT ''"))
        if "error_message" not in column_names:
            connection.execute(text("ALTER TABLE uploaded_files ADD COLUMN error_message TEXT NOT NULL DEFAULT ''"))


def _ensure_report_columns() -> None:
    inspector = inspect(engine)
    if "reports" not in inspector.get_table_names():
        return

    column_names = {column["name"] for column in inspector.get_columns("reports")}
    with engine.begin() as connection:
        if "status" not in column_names:
            connection.execute(text("ALTER TABLE reports ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'completed'"))
        if "error_message" not in column_names:
            connection.execute(text("ALTER TABLE reports ADD COLUMN error_message TEXT NOT NULL DEFAULT ''"))


def init_db() -> None:
    from app.db import models

    Base.metadata.create_all(bind=engine)
    _ensure_user_columns()
    _ensure_uploaded_file_columns()
    _ensure_report_columns()

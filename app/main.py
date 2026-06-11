"""FastAPI 应用入口，负责创建应用、注册路由并初始化数据库表。"""
from fastapi import FastAPI

from app.api.router import api_router
from app.db.database import init_db


def create_app() -> FastAPI:
    init_db()
    app = FastAPI(title="Agent Backend", version="0.1.0")
    app.include_router(api_router)
    return app


app = create_app()

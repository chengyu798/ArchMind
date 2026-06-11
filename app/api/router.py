from fastapi import APIRouter

from app.api.routes import auth, chat, files, health, jobs, knowledge, memories, reports, settings

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(chat.router)
api_router.include_router(files.router)
api_router.include_router(knowledge.router)
api_router.include_router(memories.router)
api_router.include_router(reports.router)
api_router.include_router(jobs.router)
api_router.include_router(settings.router)

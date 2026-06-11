"""后台任务路由，提供当前用户任务状态查询。"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db.database import get_db
from app.schemas.jobs import BackgroundJobResponse
from app.services.job_service import get_user_job

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=BackgroundJobResponse)
def get_job(job_id: int, current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    job = get_user_job(db, current_user.id, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    return job

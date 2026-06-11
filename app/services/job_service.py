"""后台任务服务，负责记录异步任务状态和失败原因。"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import BackgroundJob


ERROR_MESSAGE_LIMIT = 1000


def create_background_job(db: Session, user_id: int, job_type: str, target_type: str, target_id: int) -> BackgroundJob:
    job = BackgroundJob(user_id=user_id, job_type=job_type, target_type=target_type, target_id=target_id, status="queued")
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_user_job(db: Session, user_id: int, job_id: int) -> BackgroundJob | None:
    return db.scalar(select(BackgroundJob).where(BackgroundJob.id == job_id, BackgroundJob.user_id == user_id))


def get_latest_target_job(db: Session, user_id: int, job_type: str, target_type: str, target_id: int) -> BackgroundJob | None:
    return db.scalar(
        select(BackgroundJob)
        .where(
            BackgroundJob.user_id == user_id,
            BackgroundJob.job_type == job_type,
            BackgroundJob.target_type == target_type,
            BackgroundJob.target_id == target_id,
        )
        .order_by(BackgroundJob.created_at.desc(), BackgroundJob.id.desc())
    )


def mark_job_running(db: Session, job: BackgroundJob) -> BackgroundJob:
    job.status = "running"
    job.attempts += 1
    job.error_message = ""
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def mark_job_succeeded(db: Session, job: BackgroundJob) -> BackgroundJob:
    job.status = "succeeded"
    job.error_message = ""
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def mark_job_failed(db: Session, job: BackgroundJob, error_message: str) -> BackgroundJob:
    job.status = "failed"
    job.error_message = error_message[:ERROR_MESSAGE_LIMIT]
    db.add(job)
    db.commit()
    db.refresh(job)
    return job

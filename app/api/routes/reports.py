"""报告路由模块，提供知识库报告生成、查询和删除接口。"""
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db.database import get_db
from app.schemas.report import ReportGenerateRequest, ReportGenerateResponse, ReportResponse
from app.services.report_service import delete_user_report, get_user_report, list_user_reports, run_generate_report_task, start_generate_user_report

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("", response_model=list[ReportResponse])
def list_reports(current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    return list_user_reports(db, current_user)


@router.post("/generate", response_model=ReportGenerateResponse)
def generate_report(
    payload: ReportGenerateRequest,
    current_user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    background_tasks: BackgroundTasks,
):
    report, job = start_generate_user_report(db, current_user, payload)
    background_tasks.add_task(run_generate_report_task, report.id, current_user.id, job.id)
    return ReportGenerateResponse(report=report, job=job)


@router.get("/{report_id}", response_model=ReportResponse)
def get_report(report_id: int, current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    return get_user_report(db, current_user, report_id)


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(report_id: int, current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    delete_user_report(db, current_user, report_id)

"""报告服务层，负责基于当前用户数据生成、保存和查询知识库报告。"""
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.agent.agent import UserAgentService
from app.db.database import SessionLocal
from app.db.models import BackgroundJob, ChatSession, Message, Report, UploadedFile, User
from app.schemas.report import ReportGenerateRequest
from app.services.job_service import create_background_job, mark_job_failed, mark_job_running, mark_job_succeeded
from app.services.memory_service import format_user_memories
from app.utils.logger_tool import logger

REPORT_ERROR_MESSAGE_LIMIT = 1000

user_agent_service = UserAgentService()


def get_owned_report(db: Session, report_id: int, user_id: int) -> Report:
    report = db.scalar(select(Report).where(Report.id == report_id, Report.user_id == user_id))
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报告不存在")
    return report


def list_user_reports(db: Session, current_user: User) -> list[Report]:
    logger.info(f"[报告管理]查询报告列表，user_id={current_user.id}")
    return db.scalars(
        select(Report)
        .where(Report.user_id == current_user.id)
        .order_by(Report.updated_at.desc(), Report.id.desc())
    ).all()


def get_user_report(db: Session, current_user: User, report_id: int) -> Report:
    logger.info(f"[报告管理]查询报告详情，user_id={current_user.id}，report_id={report_id}")
    return get_owned_report(db, report_id, current_user.id)


def delete_user_report(db: Session, current_user: User, report_id: int) -> None:
    report = get_owned_report(db, report_id, current_user.id)
    db.delete(report)
    db.commit()
    logger.info(f"[报告管理]删除报告成功，user_id={current_user.id}，report_id={report_id}")


def build_report_content(db: Session, current_user: User, payload: ReportGenerateRequest) -> str:
    total_files = db.scalar(select(func.count(UploadedFile.id)).where(UploadedFile.user_id == current_user.id)) or 0
    indexed_files = db.scalar(
        select(func.count(UploadedFile.id)).where(UploadedFile.user_id == current_user.id, UploadedFile.status == "indexed")
    ) or 0
    indexing_files = db.scalar(
        select(func.count(UploadedFile.id)).where(UploadedFile.user_id == current_user.id, UploadedFile.status == "indexing")
    ) or 0
    failed_files = db.scalar(
        select(func.count(UploadedFile.id)).where(UploadedFile.user_id == current_user.id, UploadedFile.status == "failed")
    ) or 0
    session_count = db.scalar(select(func.count(ChatSession.id)).where(ChatSession.user_id == current_user.id)) or 0
    message_count = db.scalar(
        select(func.count(Message.id)).join(ChatSession).where(ChatSession.user_id == current_user.id)
    ) or 0

    recent_files = db.scalars(
        select(UploadedFile)
        .where(UploadedFile.user_id == current_user.id)
        .order_by(UploadedFile.updated_at.desc(), UploadedFile.id.desc())
        .limit(8)
    ).all()
    recent_sessions = db.scalars(
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.updated_at.desc(), ChatSession.id.desc())
        .limit(6)
    ).all()

    data_summary = "\n".join(
        [
            f"报告主题：{payload.topic}",
            f"统计周期：{payload.period}",
            f"关注重点：{payload.focus or '无'}",
            f"文件总数：{total_files}",
            f"已入库文件：{indexed_files}",
            f"入库中文件：{indexing_files}",
            f"失败文件：{failed_files}",
            f"会话数：{session_count}",
            f"消息数：{message_count}",
            "最近文件：" + ("；".join(f"{file.filename}({file.status})" for file in recent_files) or "无"),
            "最近会话：" + ("；".join(session.title for session in recent_sessions) or "无"),
        ]
    )

    query = f"请基于以下用户知识库数据生成结构化报告。\n{data_summary}"
    content = user_agent_service.generate_answer(
        query,
        current_user.id,
        memory=format_user_memories(db, current_user.id),
        report=True,
    ).strip()
    if not content:
        content = "报告生成失败：Agent 未返回有效内容，请稍后重试。"
    return content


def generate_user_report(db: Session, current_user: User, payload: ReportGenerateRequest) -> Report:
    logger.info(f"[报告生成]开始生成报告，user_id={current_user.id}，topic={payload.topic}，period={payload.period}")
    content = build_report_content(db, current_user, payload)

    report = Report(
        user_id=current_user.id,
        title=payload.topic.strip(),
        period=payload.period.strip(),
        focus=payload.focus.strip(),
        content=content,
        status="completed",
        error_message="",
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    logger.info(f"[报告生成]报告生成完成，user_id={current_user.id}，report_id={report.id}，content_length={len(content)}")
    return report


def start_generate_user_report(db: Session, current_user: User, payload: ReportGenerateRequest) -> tuple[Report, BackgroundJob]:
    report = Report(
        user_id=current_user.id,
        title=payload.topic.strip(),
        period=payload.period.strip(),
        focus=payload.focus.strip(),
        content="报告正在生成中，请稍后刷新查看。",
        status="generating",
        error_message="",
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    job = create_background_job(db, current_user.id, "report_generate", "report", report.id)
    logger.info(f"[报告生成]后台任务已创建，user_id={current_user.id}，report_id={report.id}，job_id={job.id}")
    return report, job


def run_generate_report_task(report_id: int, user_id: int, job_id: int) -> None:
    with SessionLocal() as db:
        report = get_owned_report(db, report_id, user_id)
        job = db.get(BackgroundJob, job_id)
        if job is not None:
            mark_job_running(db, job)
        payload = ReportGenerateRequest(topic=report.title, period=report.period, focus=report.focus)
        try:
            report.content = build_report_content(db, report.user, payload)
            report.status = "completed"
            report.error_message = ""
            db.commit()
            if job is not None:
                mark_job_succeeded(db, job)
            logger.info(f"[报告生成]后台报告生成完成，user_id={user_id}，report_id={report_id}")
        except Exception as e:
            error_message = str(e) or "报告生成失败"
            report.status = "failed"
            report.error_message = error_message[:REPORT_ERROR_MESSAGE_LIMIT]
            report.content = "报告生成失败，请稍后重试。"
            db.commit()
            if job is not None:
                mark_job_failed(db, job, error_message)
            logger.error(f"[报告生成]后台报告生成失败，user_id={user_id}，report_id={report_id}，原因：{error_message}", exc_info=True)

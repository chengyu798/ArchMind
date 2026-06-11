"""文件服务层，负责上传校验、文件保存、去重、入库、查询和删除。"""
import os
import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.models import BackgroundJob, UploadedFile, User
from app.rag.file_parser import parse_uploaded_file
from app.rag.vector_store import VectorStoreService
from app.schemas.files import FileIndexResponse, FileIndexTaskResponse, FilePreviewResponse
from app.services.job_service import create_background_job, get_latest_target_job, mark_job_failed, mark_job_running, mark_job_succeeded
from app.utils.config_loading_tool import upload_config
from app.utils.file_processing_tool import get_file_md5_hex
from app.utils.logger_tool import logger
from app.utils.path_tool import get_abs_path

vector_store_service = VectorStoreService()
FILE_PREVIEW_CONTENT_LIMIT = 6000


def _get_file_extension(filename: str) -> str:
    return Path(filename).suffix.lower().removeprefix(".")


def _get_user_upload_dir(user_id: int) -> str:
    upload_dir = get_abs_path(upload_config["upload_dir"])
    user_upload_dir = os.path.join(upload_dir, str(user_id))
    os.makedirs(user_upload_dir, exist_ok=True)
    return user_upload_dir


def get_owned_file(db: Session, file_id: int, user_id: int) -> UploadedFile:
    uploaded_file = db.scalar(select(UploadedFile).where(UploadedFile.id == file_id, UploadedFile.user_id == user_id))
    if uploaded_file is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
    return uploaded_file


def upload_user_file(db: Session, current_user: User, file: UploadFile) -> UploadedFile:
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件名不能为空")

    file_type = _get_file_extension(file.filename)
    allowed_file_types = set(upload_config["allowed_file_types"])
    if file_type not in allowed_file_types:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的文件类型")

    max_file_size = upload_config["max_file_size_mb"] * 1024 * 1024
    user_upload_dir = _get_user_upload_dir(current_user.id)
    safe_filename = os.path.basename(file.filename)
    temp_file_path = os.path.join(user_upload_dir, f"{uuid4().hex}.tmp")
    file_size = 0

    try:
        with open(temp_file_path, "wb") as target:
            while chunk := file.file.read(1024 * 1024):
                file_size += len(chunk)
                if file_size > max_file_size:
                    raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="文件大小超出限制")
                target.write(chunk)

        md5 = get_file_md5_hex(temp_file_path)
        if not md5:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件 MD5 计算失败")

        existing_file = db.scalar(select(UploadedFile).where(UploadedFile.user_id == current_user.id, UploadedFile.md5 == md5))
        if existing_file:
            logger.info(f"[文件上传]检测到重复文件，user_id={current_user.id}，file_id={existing_file.id}，md5={md5}")
            os.remove(temp_file_path)
            return existing_file

        stored_filename = f"{uuid4().hex}_{safe_filename}"
        stored_file_path = os.path.join(user_upload_dir, stored_filename)
        shutil.move(temp_file_path, stored_file_path)

        uploaded_file = UploadedFile(
            user_id=current_user.id,
            filename=safe_filename,
            file_path=stored_file_path,
            file_type=file_type,
            file_size=file_size,
            md5=md5,
            status="uploaded",
            error_message="",
        )
        db.add(uploaded_file)
        db.commit()
        db.refresh(uploaded_file)
        logger.info(f"[文件上传]文件上传成功，user_id={current_user.id}，file_id={uploaded_file.id}，path={stored_file_path}")
        return uploaded_file
    finally:
        file.file.close()
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


def list_user_files(db: Session, current_user: User) -> list[UploadedFile]:
    return db.scalars(
        select(UploadedFile)
        .where(UploadedFile.user_id == current_user.id)
        .order_by(UploadedFile.created_at.desc(), UploadedFile.id.desc())
    ).all()


def preview_user_file(db: Session, current_user: User, file_id: int) -> FilePreviewResponse:
    uploaded_file = get_owned_file(db, file_id, current_user.id)
    try:
        documents = parse_uploaded_file(uploaded_file.file_path, uploaded_file.file_type)
    except Exception as e:
        logger.error(f"[文件预览]文件解析失败，user_id={current_user.id}，file_id={file_id}，原因：{str(e)}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件内容预览失败") from e

    content = "\n\n".join(document.page_content for document in documents if document.page_content).strip()
    truncated = len(content) > FILE_PREVIEW_CONTENT_LIMIT
    if truncated:
        content = f"{content[:FILE_PREVIEW_CONTENT_LIMIT]}\n\n……内容较长，仅展示前 {FILE_PREVIEW_CONTENT_LIMIT} 个字符。"
    return FilePreviewResponse(file=uploaded_file, content=content or "文件没有可预览的文本内容。", truncated=truncated)


def start_index_user_file(db: Session, current_user: User, file_id: int) -> FileIndexTaskResponse:
    uploaded_file = get_owned_file(db, file_id, current_user.id)
    if uploaded_file.file_type not in set(upload_config["allowed_file_types"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前文件类型暂不支持入库")

    if uploaded_file.status == "indexing":
        job = get_latest_target_job(db, current_user.id, "file_index", "uploaded_file", uploaded_file.id)
        return FileIndexTaskResponse(file=uploaded_file, message="文件正在入库中", job=job)

    logger.info(f"[文件入库]收到后台入库请求，user_id={current_user.id}，file_id={file_id}")
    uploaded_file.status = "indexing"
    uploaded_file.error_message = ""
    db.commit()
    db.refresh(uploaded_file)
    job = create_background_job(db, current_user.id, "file_index", "uploaded_file", uploaded_file.id)
    return FileIndexTaskResponse(file=uploaded_file, message="文件入库任务已开始", job=job)


def run_index_file_task(file_id: int, user_id: int, job_id: int | None = None) -> None:
    with SessionLocal() as db:
        uploaded_file = get_owned_file(db, file_id, user_id)
        job = db.get(BackgroundJob, job_id) if job_id is not None else get_latest_target_job(db, user_id, "file_index", "uploaded_file", file_id)
        if job is not None:
            mark_job_running(db, job)
        try:
            chunk_count = vector_store_service.index_uploaded_file(uploaded_file)
            if chunk_count <= 0:
                uploaded_file.status = "failed"
                uploaded_file.error_message = "文件没有可入库的有效内容"
                db.commit()
                if job is not None:
                    mark_job_failed(db, job, uploaded_file.error_message)
                logger.warning(f"[文件入库]后台入库失败，文件没有有效内容，user_id={user_id}，file_id={file_id}")
                return

            uploaded_file.status = "indexed"
            uploaded_file.error_message = ""
            db.commit()
            if job is not None:
                mark_job_succeeded(db, job)
            logger.info(f"[文件入库]后台入库成功，user_id={user_id}，file_id={file_id}，chunk_count={chunk_count}")
        except Exception as e:
            error_message = str(e) or "文件入库失败"
            uploaded_file.status = "failed"
            uploaded_file.error_message = error_message[:1000]
            db.commit()
            if job is not None:
                mark_job_failed(db, job, error_message)
            logger.error(f"[文件入库]后台入库异常，user_id={user_id}，file_id={file_id}，原因：{error_message}", exc_info=True)


def index_user_file(db: Session, current_user: User, file_id: int) -> FileIndexResponse:
    uploaded_file = get_owned_file(db, file_id, current_user.id)
    if uploaded_file.file_type not in set(upload_config["allowed_file_types"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前文件类型暂不支持入库")

    logger.info(f"[文件入库]收到文件入库请求，user_id={current_user.id}，file_id={file_id}")
    uploaded_file.status = "indexing"
    db.commit()
    db.refresh(uploaded_file)

    try:
        chunk_count = vector_store_service.index_uploaded_file(uploaded_file)
        if chunk_count <= 0:
            uploaded_file.status = "failed"
            db.commit()
            db.refresh(uploaded_file)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件没有可入库的有效内容")

        uploaded_file.status = "indexed"
        db.commit()
        db.refresh(uploaded_file)
        logger.info(f"[文件入库]文件入库成功，user_id={current_user.id}，file_id={file_id}，chunk_count={chunk_count}")
        return FileIndexResponse(file=uploaded_file, chunk_count=chunk_count)
    except HTTPException:
        raise
    except Exception as e:
        uploaded_file.status = "failed"
        db.commit()
        logger.error(f"[文件入库]文件入库失败，user_id={current_user.id}，file_id={file_id}，原因：{str(e)}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="文件入库失败") from e


def delete_user_file(db: Session, current_user: User, file_id: int) -> None:
    uploaded_file = get_owned_file(db, file_id, current_user.id)
    file_path = uploaded_file.file_path

    vector_store_service.delete_uploaded_file_vectors(uploaded_file)
    db.delete(uploaded_file)
    db.commit()

    if os.path.exists(file_path):
        os.remove(file_path)
        logger.info(f"[文件删除]文件删除成功，user_id={current_user.id}，file_id={file_id}，path={file_path}")

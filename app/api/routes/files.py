"""文件路由模块，提供用户文件上传、查询、删除和后台入库接口。"""
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, UploadFile, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db.database import get_db
from app.schemas.files import FileIndexTaskResponse, FilePreviewResponse, FileResponse
from app.services.file_service import (
    delete_user_file,
    get_owned_file,
    list_user_files,
    preview_user_file,
    run_index_file_task,
    start_index_user_file,
    upload_user_file,
)

router = APIRouter(prefix="/files", tags=["files"])


@router.post("/upload", response_model=FileResponse, status_code=status.HTTP_201_CREATED)
def upload_file(
    current_user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    file: Annotated[UploadFile, File()],
):
    return upload_user_file(db, current_user, file)


@router.get("", response_model=list[FileResponse])
def list_files(current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    return list_user_files(db, current_user)


@router.post("/{file_id}/index", response_model=FileIndexTaskResponse)
def index_file(
    file_id: int,
    current_user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    background_tasks: BackgroundTasks,
):
    response = start_index_user_file(db, current_user, file_id)
    if response.message == "文件入库任务已开始" and response.job is not None:
        background_tasks.add_task(run_index_file_task, file_id, current_user.id, response.job.id)
    return response


@router.get("/{file_id}/preview", response_model=FilePreviewResponse)
def preview_file(file_id: int, current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    return preview_user_file(db, current_user, file_id)


@router.get("/{file_id}", response_model=FileResponse)
def get_file(file_id: int, current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    return get_owned_file(db, file_id, current_user.id)


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_file(file_id: int, current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    delete_user_file(db, current_user, file_id)

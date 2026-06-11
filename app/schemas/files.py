"""文件接口的 Pydantic 模型，定义上传文件元数据和入库响应结构。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.jobs import BackgroundJobResponse


class FileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    filename: str
    file_path: str
    file_type: str
    file_size: int
    md5: str
    status: str
    error_message: str
    created_at: datetime
    updated_at: datetime


class FileIndexResponse(BaseModel):
    file: FileResponse
    chunk_count: int


class FileIndexTaskResponse(BaseModel):
    file: FileResponse
    message: str
    job: BackgroundJobResponse | None = None


class FilePreviewResponse(BaseModel):
    file: FileResponse
    content: str
    truncated: bool

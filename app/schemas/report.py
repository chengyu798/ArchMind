"""报告接口的 Pydantic 模型，定义报告生成、列表和详情响应。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.jobs import BackgroundJobResponse


class ReportGenerateRequest(BaseModel):
    topic: str = Field(default="知识库使用报告", min_length=1, max_length=120)
    period: str = Field(default="本月", min_length=1, max_length=40)
    focus: str = Field(default="", max_length=500)


class ReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    title: str
    period: str
    focus: str
    content: str
    status: str
    error_message: str
    created_at: datetime
    updated_at: datetime


class ReportGenerateResponse(BaseModel):
    report: ReportResponse
    job: BackgroundJobResponse | None = None

"""后台任务接口模型。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class BackgroundJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    job_type: str
    target_type: str
    target_id: int
    status: str
    attempts: int
    error_message: str
    created_at: datetime
    updated_at: datetime

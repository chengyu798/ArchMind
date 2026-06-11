"""设置路由，提供模型配置查看和更新。"""
from fastapi import APIRouter

from app.auth.dependencies import AdminUser, CurrentUser
from app.schemas.settings import ModelSettingsResponse, ModelSettingsUpdateRequest, RagSettingsResponse, RagSettingsUpdateRequest
from app.services.settings_service import get_model_settings, get_rag_settings, update_model_settings, update_rag_settings

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/model", response_model=ModelSettingsResponse)
def get_model_setting(_current_user: CurrentUser):
    return get_model_settings()


@router.patch("/model", response_model=ModelSettingsResponse)
def update_model_setting(payload: ModelSettingsUpdateRequest, _current_user: AdminUser):
    return update_model_settings(payload)


@router.get("/rag", response_model=RagSettingsResponse)
def get_rag_setting(_current_user: CurrentUser):
    return get_rag_settings()


@router.patch("/rag", response_model=RagSettingsResponse)
def update_rag_setting(payload: RagSettingsUpdateRequest, _current_user: AdminUser):
    return update_rag_settings(payload)

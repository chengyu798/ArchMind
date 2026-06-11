"""知识检索路由模块，提供基于当前用户已入库文件的向量检索接口。"""
from fastapi import APIRouter, HTTPException, Query, status

from app.auth.dependencies import CurrentUser
from app.rag.vector_store import VectorStoreService
from app.schemas.knowledge import KnowledgeSearchRequest, KnowledgeSearchResponse, KnowledgeSearchResult, SourceLookupResponse
from app.utils.logger_tool import logger

router = APIRouter(prefix="/knowledge", tags=["knowledge"])
vector_store_service = VectorStoreService()


@router.post("/search", response_model=KnowledgeSearchResponse)
def search_knowledge(payload: KnowledgeSearchRequest, current_user: CurrentUser):
    logger.info(f"[知识检索]收到检索请求，user_id={current_user.id}，query={payload.query}，k={payload.k}")
    documents = vector_store_service.search_user_documents(payload.query, current_user.id, payload.k)
    results = [KnowledgeSearchResult(content=document.page_content, metadata=document.metadata) for document in documents]
    logger.info(f"[知识检索]检索完成，user_id={current_user.id}，结果数：{len(results)}")
    return KnowledgeSearchResponse(results=results)


@router.get("/sources/lookup", response_model=SourceLookupResponse)
def lookup_source(
    current_user: CurrentUser,
    filename: str | None = Query(default=None, min_length=1),
    location: str | None = Query(default=None, min_length=1),
    file_id: int | None = Query(default=None, ge=1),
):
    logger.info(f"[来源定位]查询来源片段，user_id={current_user.id}，filename={filename}，location={location}，file_id={file_id}")
    if not filename and file_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="来源定位缺少文件标识")
    document = vector_store_service.find_user_source_document(
        user_id=current_user.id,
        filename=filename,
        location=location,
        file_id=file_id,
    )
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="没有找到对应的来源片段")
    return SourceLookupResponse(content=document.page_content, metadata=document.metadata)

"""知识库检索工具，供 Agent 按当前用户检索已入库文件内容。"""
from langchain_core.documents import Document
from langchain_core.tools import tool

from app.rag.vector_store import VectorStoreService
from app.utils.logger_tool import logger

vector_store_service = VectorStoreService()
MAX_QUERY_LENGTH = 300
MAX_DOCUMENT_CONTENT_LENGTH = 1200


def _format_document(index: int, document: Document) -> str:
    filename = document.metadata.get("filename") or "未知文件"
    file_type = document.metadata.get("file_type") or "未知类型"
    file_id = document.metadata.get("file_id")
    chunk_index = document.metadata.get("chunk_index")
    row_index = document.metadata.get("row_index")
    slide_number = document.metadata.get("slide_number")
    location = f"第 {chunk_index} 个片段" if chunk_index is not None else "未知片段"
    if row_index is not None:
        location = f"第 {row_index} 行"
    if slide_number is not None:
        location = f"第 {slide_number} 页幻灯片"

    content = document.page_content.strip()
    if len(content) > MAX_DOCUMENT_CONTENT_LENGTH:
        content = f"{content[:MAX_DOCUMENT_CONTENT_LENGTH]}…"

    return "\n".join(
        [
            f"【参考资料{index}】",
            f"来源ID：S{index}",
            f"文件名：{filename}",
            f"文件ID：{file_id}" if file_id is not None else "文件ID：未知",
            f"文件类型：{file_type}",
            f"位置：{location}",
            f"内容：{content}",
        ]
    )


@tool(description="按当前用户ID检索其私有知识库。仅当问题需要用户上传文件内容时调用；必须传入当前登录用户ID和精炼后的检索问题。返回带来源ID、文件名、文件ID、位置和内容的参考资料。")
def search_user_knowledge(user_id: int, query: str) -> str:
    normalized_query = query.strip()
    if not normalized_query:
        return "检索问题不能为空。"
    if len(normalized_query) > MAX_QUERY_LENGTH:
        normalized_query = normalized_query[:MAX_QUERY_LENGTH]

    logger.info(f"[Agent工具]检索用户知识库，user_id={user_id}，query={normalized_query}")
    documents = vector_store_service.search_user_documents(query=normalized_query, user_id=user_id)
    if not documents:
        return "当前知识库中没有检索到相关内容。"

    seen_keys: set[tuple[object, object, str]] = set()
    unique_documents: list[Document] = []
    for document in documents:
        key = (document.metadata.get("file_id"), document.metadata.get("chunk_index"), document.page_content[:80])
        if key in seen_keys:
            continue
        seen_keys.add(key)
        unique_documents.append(document)

    return "\n\n".join(_format_document(index, document) for index, document in enumerate(unique_documents, start=1))

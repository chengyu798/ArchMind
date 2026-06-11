"""向量库服务，负责文档切片、ChromaDB 入库、用户级检索和文件向量删除。"""
import re

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.db.models import UploadedFile
from app.models.factory import embedding_model
from app.rag.file_parser import parse_uploaded_file
from app.services.document_chunk_service import delete_file_chunks, replace_file_chunks, search_user_chunks
from app.utils.config_loading_tool import chroma_config, model_config, rag_config
from app.utils.logger_tool import logger
from app.utils.path_tool import get_abs_path


CHINESE_RE = re.compile(r"[一-鿿]+")
TOKEN_RE = re.compile(r"[a-z0-9_]+")


def _document_key(document: Document) -> tuple[object, object, object, object]:
    metadata = document.metadata
    return (
        metadata.get("file_id") or metadata.get("source"),
        metadata.get("slide_number"),
        metadata.get("chunk_index", metadata.get("row_index")),
        document.page_content[:80],
    )


def _query_terms(query: str) -> list[str]:
    normalized = query.lower()
    terms = {term for term in TOKEN_RE.findall(normalized) if len(term) >= 2}
    for phrase in CHINESE_RE.findall(normalized):
        if len(phrase) >= 2:
            terms.add(phrase)
        for size in (2, 3, 4):
            if len(phrase) >= size:
                terms.update(phrase[index : index + size] for index in range(len(phrase) - size + 1))
    return sorted(terms, key=len, reverse=True)


def _keyword_score(content: str, terms: list[str]) -> int:
    normalized = content.lower()
    return sum(normalized.count(term) for term in terms)


def _extract_location_number(location: str) -> int | None:
    match = re.search(r"第\s*(\d+)\s*(?:个片段|行|页幻灯片|页)?", location)
    return int(match.group(1)) if match else None


def _safe_collection_part(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")[:48] or "default"


def build_embedding_collection_name() -> str:
    embedding_config = model_config["embedding"]
    provider = _safe_collection_part(embedding_config["provider"])
    model_name = _safe_collection_part(embedding_config["model_name"])
    return f"{chroma_config['collection_name']}-{provider}-{model_name}"


class VectorStoreService:
    def __init__(self):
        self.collection_name = build_embedding_collection_name()
        self.vector_store = Chroma(
            collection_name=self.collection_name,
            embedding_function=embedding_model,
            persist_directory=get_abs_path(chroma_config["persist_directory"]),
        )
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=rag_config["chunk_size"],
            chunk_overlap=rag_config["chunk_overlap"],
            separators=rag_config["separators"],
            length_function=len,
        )

    def get_retriever(self):
        return self.vector_store.as_retriever(search_kwargs={"k": rag_config["k"]})

    def search_user_documents(self, query: str, user_id: int, k: int | None = None) -> list[Document]:
        search_k = k or rag_config["k"]
        logger.info(f"[混合检索]开始用户级检索，user_id={user_id}，k={search_k}，query={query}")
        vector_documents = self.vector_store.similarity_search(query, k=search_k, filter={"user_id": user_id})
        keyword_documents = self.keyword_search_user_documents(query=query, user_id=user_id, k=max(search_k * 2, 6))

        scored_documents: dict[tuple[object, object, object, object], tuple[Document, int]] = {}
        for rank, document in enumerate(vector_documents):
            key = _document_key(document)
            score = (search_k - rank) * 10
            scored_documents[key] = (document, score)

        for rank, document in enumerate(keyword_documents):
            key = _document_key(document)
            keyword_score = int(document.metadata.pop("keyword_score", 0))
            rank_bonus = max(len(keyword_documents) - rank, 1)
            existing_document, existing_score = scored_documents.get(key, (document, 0))
            scored_documents[key] = (existing_document, existing_score + keyword_score * 8 + rank_bonus)

        result_limit = max(search_k, min(search_k * 2, len(scored_documents)))
        documents = [
            document
            for document, _score in sorted(scored_documents.values(), key=lambda item: item[1], reverse=True)[:result_limit]
        ]
        logger.info(
            f"[混合检索]用户级检索完成，user_id={user_id}，向量命中：{len(vector_documents)}，关键词命中：{len(keyword_documents)}，返回：{len(documents)}"
        )
        return documents

    def keyword_search_user_documents(self, query: str, user_id: int, k: int | None = None) -> list[Document]:
        terms = _query_terms(query)
        keyword_k = k or rag_config["k"]
        return search_user_chunks(user_id=user_id, terms=terms, k=keyword_k, embedding_collection=self.collection_name)

    def find_user_source_document(
        self,
        user_id: int,
        filename: str | None = None,
        location: str | None = None,
        file_id: int | None = None,
    ) -> Document | None:
        filters: list[dict[str, object]] = [{"user_id": user_id}]
        if file_id is not None:
            filters.append({"file_id": file_id})
        if filename:
            filters.append({"filename": filename})

        where = filters[0] if len(filters) == 1 else {"$and": filters}
        result = self.vector_store._collection.get(where=where, include=["documents", "metadatas"])
        contents = result.get("documents") or []
        metadatas = result.get("metadatas") or []
        documents = [
            Document(page_content=content, metadata=dict(metadata or {}))
            for content, metadata in zip(contents, metadatas, strict=False)
            if content
        ]
        documents.sort(
            key=lambda document: (
                document.metadata.get("chunk_index", 0),
                document.metadata.get("row_index", 0),
                document.metadata.get("slide_number", 0),
            )
        )
        if not documents:
            return None

        location_number = _extract_location_number(location or "")
        if location_number is None:
            return documents[0]

        if "行" in (location or ""):
            target_key = "row_index"
        elif "幻灯片" in (location or ""):
            target_key = "slide_number"
        else:
            target_key = "chunk_index"

        for document in documents:
            if document.metadata.get(target_key) == location_number:
                return document
        return documents[0]

    def delete_uploaded_file_vectors(self, uploaded_file: UploadedFile) -> None:
        logger.info(f"[向量删除]开始删除文件向量，user_id={uploaded_file.user_id}，file_id={uploaded_file.id}")
        collection = self.vector_store._collection
        result = collection.get(
            where={
                "$and": [
                    {"user_id": uploaded_file.user_id},
                    {"file_id": uploaded_file.id},
                    {"md5": uploaded_file.md5},
                    {"source": uploaded_file.file_path},
                ]
            }
        )
        ids = result.get("ids", [])
        if not ids:
            delete_file_chunks(uploaded_file)
            logger.info(f"[向量删除]文件没有已入库向量，user_id={uploaded_file.user_id}，file_id={uploaded_file.id}")
            return

        self.vector_store.delete(ids=ids)
        delete_file_chunks(uploaded_file)
        logger.info(f"[向量删除]文件向量删除完成，user_id={uploaded_file.user_id}，file_id={uploaded_file.id}，删除数量：{len(ids)}")

    def index_uploaded_file(self, uploaded_file: UploadedFile) -> int:
        logger.info(
            f"[文件入库]开始入库上传文件，user_id={uploaded_file.user_id}，file_id={uploaded_file.id}，path={uploaded_file.file_path}"
        )
        documents = parse_uploaded_file(uploaded_file.file_path, uploaded_file.file_type)
        if not documents:
            logger.warning(f"[文件入库]文件解析结果为空，file_id={uploaded_file.id}")
            return 0

        split_documents = self.splitter.split_documents(documents)
        if not split_documents:
            logger.warning(f"[文件入库]文件切片结果为空，file_id={uploaded_file.id}")
            return 0

        ids: list[str] = []
        for index, document in enumerate(split_documents):
            document.metadata.update(
                {
                    "md5": uploaded_file.md5,
                    "user_id": uploaded_file.user_id,
                    "file_id": uploaded_file.id,
                    "filename": uploaded_file.filename,
                    "file_type": uploaded_file.file_type,
                    "chunk_index": index,
                    "source": uploaded_file.file_path,
                }
            )
            ids.append(f"user-{uploaded_file.user_id}-file-{uploaded_file.id}-chunk-{index}")

        self.delete_uploaded_file_vectors(uploaded_file)
        self.vector_store.add_documents(split_documents, ids=ids)
        replace_file_chunks(uploaded_file, split_documents, self.collection_name)
        logger.info(f"[文件入库]上传文件入库完成，file_id={uploaded_file.id}，切片数量：{len(split_documents)}")
        return len(split_documents)

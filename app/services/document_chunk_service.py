"""文档切片索引服务，用 SQLite 保存可过滤的关键词检索数据。"""
from langchain_core.documents import Document
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.models import DocumentChunk, UploadedFile


KEYWORD_SCAN_LIMIT = 500


def replace_file_chunks(uploaded_file: UploadedFile, documents: list[Document], embedding_collection: str) -> None:
    with SessionLocal() as db:
        db.execute(delete(DocumentChunk).where(DocumentChunk.user_id == uploaded_file.user_id, DocumentChunk.file_id == uploaded_file.id))
        for index, document in enumerate(documents):
            metadata = document.metadata
            db.add(
                DocumentChunk(
                    user_id=uploaded_file.user_id,
                    file_id=uploaded_file.id,
                    filename=uploaded_file.filename,
                    file_type=uploaded_file.file_type,
                    chunk_index=int(metadata.get("chunk_index", index)),
                    row_index=metadata.get("row_index"),
                    slide_number=metadata.get("slide_number"),
                    source=uploaded_file.file_path,
                    content=document.page_content,
                    embedding_collection=embedding_collection,
                )
            )
        db.commit()


def delete_file_chunks(uploaded_file: UploadedFile) -> None:
    with SessionLocal() as db:
        db.execute(delete(DocumentChunk).where(DocumentChunk.user_id == uploaded_file.user_id, DocumentChunk.file_id == uploaded_file.id))
        db.commit()


def search_user_chunks(user_id: int, terms: list[str], k: int, embedding_collection: str) -> list[Document]:
    if not terms:
        return []

    with SessionLocal() as db:
        chunks = db.scalars(
            select(DocumentChunk)
            .where(DocumentChunk.user_id == user_id, DocumentChunk.embedding_collection == embedding_collection)
            .order_by(DocumentChunk.created_at.desc(), DocumentChunk.id.desc())
            .limit(KEYWORD_SCAN_LIMIT)
        ).all()

    scored: list[tuple[int, Document]] = []
    for chunk in chunks:
        content = chunk.content or ""
        normalized = content.lower()
        score = sum(normalized.count(term) for term in terms)
        if score <= 0:
            continue
        metadata = {
            "user_id": chunk.user_id,
            "file_id": chunk.file_id,
            "filename": chunk.filename,
            "file_type": chunk.file_type,
            "chunk_index": chunk.chunk_index,
            "source": chunk.source,
            "keyword_score": score,
        }
        if chunk.row_index is not None:
            metadata["row_index"] = chunk.row_index
        if chunk.slide_number is not None:
            metadata["slide_number"] = chunk.slide_number
        scored.append((score, Document(page_content=content, metadata=metadata)))

    return [document for _score, document in sorted(scored, key=lambda item: item[0], reverse=True)[:k]]

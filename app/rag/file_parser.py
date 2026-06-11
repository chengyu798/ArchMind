"""上传文件解析器，负责将用户上传的 txt、md、pdf、csv、docx、pptx 文件转换为 LangChain Document。"""
from langchain_core.documents import Document

from app.utils.file_processing_tool import csv_loader, docx_loader, pdf_loader, pptx_loader, txt_loader
from app.utils.logger_tool import logger


def parse_uploaded_file(file_path: str, file_type: str) -> list[Document]:
    logger.info(f"[文件解析]开始解析文件：{file_path}，类型：{file_type}")

    try:
        if file_type in {"txt", "md"}:
            documents = txt_loader(file_path)
        elif file_type == "pdf":
            documents = pdf_loader(file_path)
        elif file_type == "csv":
            documents = csv_loader(file_path)
        elif file_type == "docx":
            documents = docx_loader(file_path)
        elif file_type == "pptx":
            documents = pptx_loader(file_path)
        else:
            logger.warning(f"[文件解析]不支持的文件类型：{file_type}，文件：{file_path}")
            return []

        logger.info(f"[文件解析]文件解析成功：{file_path}，Document数量：{len(documents)}")
        return documents
    except Exception as e:
        logger.error(f"[文件解析]文件解析失败：{file_path}，原因：{str(e)}", exc_info=True)
        raise e

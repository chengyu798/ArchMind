import os
import hashlib
import csv
import zipfile
from xml.etree import ElementTree

from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_core.documents import Document

from app.utils.logger_tool import logger

MAX_ARCHIVE_ENTRIES = 2000
MAX_ARCHIVE_MEMBER_SIZE = 20 * 1024 * 1024
MAX_ARCHIVE_TOTAL_SIZE = 100 * 1024 * 1024

def get_file_md5_hex(filepath: str):
    """
    获取文件的md5的十六进制字符串，用于文件的唯一标识和去重
    """
    if not os.path.exists(filepath):
        logger.error(f'[md5计算]文件{filepath}不存在')
        return None

    if not os.path.isfile(filepath):
        logger.error(f'[md5计算]路径{filepath}不是文件')
        return None

    md5_obj = hashlib.md5()

    chunk_size = 4096  # 4k分片，避免文件过大
    try:
        with open(filepath, 'rb') as f:
            chunk = f.read(chunk_size)
            while chunk:
                md5_obj.update(chunk)
                chunk = f.read(chunk_size)

            md5_hex = md5_obj.hexdigest()
            return md5_hex
    except Exception as e:
        logger.error(f'[md5计算]计算文件{filepath}md5失败，{str(e)}')
        return None


    if not os.path.isdir(path):
        logger.error(f"[listdir_with_allowed_type]{path}不是文件夹")
        return None

    for f in os.listdir(path):
        if f.endswith(allowed_types):
            file_list.append(os.path.join(path, f))

    return tuple(file_list)

def pdf_loader(filepath: str, passwd=None) -> list[Document]:
    return PyPDFLoader(filepath, passwd).load()

def txt_loader(filepath: str) -> list[Document]:
    return TextLoader(filepath,encoding="utf-8").load()


def csv_loader(filepath: str) -> list[Document]:
    documents: list[Document] = []
    with open(filepath, "r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames:
            for index, row in enumerate(reader, start=1):
                content = "；".join(f"{key}：{value}" for key, value in row.items() if value not in {None, ""})
                if content:
                    documents.append(Document(page_content=content, metadata={"row_index": index, "source": filepath}))
            return documents

    with open(filepath, "r", encoding="utf-8-sig", newline="") as file:
        reader = csv.reader(file)
        for index, row in enumerate(reader, start=1):
            content = "，".join(cell for cell in row if cell)
            if content:
                documents.append(Document(page_content=content, metadata={"row_index": index, "source": filepath}))
    return documents


def _validate_archive(archive: zipfile.ZipFile) -> None:
    infos = archive.infolist()
    if len(infos) > MAX_ARCHIVE_ENTRIES:
        raise ValueError("压缩包条目过多")
    total_size = 0
    for info in infos:
        normalized_name = info.filename.replace("\\", "/")
        if normalized_name.startswith("/") or ".." in normalized_name.split("/"):
            raise ValueError("压缩包包含不安全路径")
        if info.file_size > MAX_ARCHIVE_MEMBER_SIZE:
            raise ValueError("压缩包单个文件过大")
        total_size += info.file_size
        if total_size > MAX_ARCHIVE_TOTAL_SIZE:
            raise ValueError("压缩包解压后内容过大")


def _open_safe_zip(filepath: str) -> zipfile.ZipFile:
    archive = zipfile.ZipFile(filepath)
    try:
        _validate_archive(archive)
        return archive
    except Exception:
        archive.close()
        raise


def _extract_xml_text(xml_bytes: bytes) -> str:
    root = ElementTree.fromstring(xml_bytes)
    parts = [node.text for node in root.iter() if node.tag.endswith("}t") and node.text]
    return "\n".join(part.strip() for part in parts if part.strip())


def docx_loader(filepath: str) -> list[Document]:
    with _open_safe_zip(filepath) as archive:
        part_names = [
            name
            for name in archive.namelist()
            if name == "word/document.xml" or name.startswith(("word/header", "word/footer")) and name.endswith(".xml")
        ]
        texts = []
        for name in part_names:
            text = _extract_xml_text(archive.read(name))
            if text:
                texts.append(text)
    content = "\n\n".join(texts).strip()
    return [Document(page_content=content, metadata={"source": filepath})] if content else []


def _slide_sort_key(name: str) -> int:
    stem = os.path.basename(name).removeprefix("slide").removesuffix(".xml")
    return int(stem) if stem.isdigit() else 0


def pptx_loader(filepath: str) -> list[Document]:
    documents: list[Document] = []
    with _open_safe_zip(filepath) as archive:
        slide_names = sorted(
            (name for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml")),
            key=_slide_sort_key,
        )
        for index, name in enumerate(slide_names, start=1):
            text = _extract_xml_text(archive.read(name))
            if text:
                documents.append(Document(page_content=text, metadata={"slide_number": index, "source": filepath}))
    return documents

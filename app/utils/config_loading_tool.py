"""加载 YAML 配置和环境变量配置。"""
import os
from typing import Any

import yaml
from dotenv import load_dotenv

from app.utils.path_tool import get_abs_path

load_dotenv(get_abs_path("../.env"))


def load_yaml_config(config_path: str, encoding: str = "utf-8") -> dict[str, Any]:
    with open(config_path, "r", encoding=encoding) as f:
        return yaml.load(f, Loader=yaml.FullLoader) or {}


def load_model_config(config_path: str = get_abs_path("config/model.yaml"), encoding: str = "utf-8"):
    return load_yaml_config(config_path, encoding)


def load_rag_config(config_path: str = get_abs_path("config/rag.yaml"), encoding: str = "utf-8"):
    return load_yaml_config(config_path, encoding)


def load_chroma_config(config_path: str = get_abs_path("config/chroma.yaml"), encoding: str = "utf-8"):
    return load_yaml_config(config_path, encoding)


def load_prompts_config(config_path: str = get_abs_path("config/prompt.yaml"), encoding: str = "utf-8"):
    return load_yaml_config(config_path, encoding)


def load_database_config(config_path: str = get_abs_path("config/database.yaml"), encoding: str = "utf-8"):
    return load_yaml_config(config_path, encoding)


def load_auth_config(config_path: str = get_abs_path("config/auth.yaml"), encoding: str = "utf-8"):
    return load_yaml_config(config_path, encoding)


def load_upload_config(config_path: str = get_abs_path("config/upload.yaml"), encoding: str = "utf-8"):
    return load_yaml_config(config_path, encoding)


def get_env_value(env_name: str) -> str:
    value = os.getenv(env_name)
    if not value:
        raise RuntimeError(f"缺少环境变量：{env_name}")
    return value


model_config = load_model_config()
rag_config = load_rag_config()
chroma_config = load_chroma_config()
prompts_config = load_prompts_config()
database_config = load_database_config()
auth_config = load_auth_config()
upload_config = load_upload_config()

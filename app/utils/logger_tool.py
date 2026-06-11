# 系统日志工具
import logging
import os
import re
from datetime import datetime
from logging.handlers import RotatingFileHandler
from app.utils.path_tool import get_abs_path

# 日志保存的根目录
LOG_ROOT = get_abs_path("logs/system_info")
SECRET_VALUE_RE = re.compile(r"(?i)(api[_-]?key|token|secret|password)([\"'\s:=]+)([^\s,;&}]+)")
SK_RE = re.compile(r"sk-[A-Za-z0-9_-]{8,}")


class RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        message = super().format(record)
        message = SECRET_VALUE_RE.sub(lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]", message)
        return SK_RE.sub("sk-[REDACTED]", message)


# 确保日志的目录存在
os.makedirs(LOG_ROOT, exist_ok=True)

# 日志的格式配置
DEFAULT_LOG_FORMAT = RedactingFormatter(
    '%(asctime)s - %(name)s - %(levelname)s - %(filename)s:%(lineno)d -%(message)s'
)

def get_logger(
        name: str = "agent",
        console_level: int = logging.INFO,
        file_level: int = logging.DEBUG,
        log_file = None
) -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)

    # 避免重复添加Handler
    if logger.handlers:
        return logger

    # 控制台log
    console_handler = logging.StreamHandler()
    console_handler.setLevel(console_level)
    console_handler.setFormatter(DEFAULT_LOG_FORMAT)
    logger.addHandler(console_handler)

    # 文件log
    if not log_file:
        log_file = os.path.join(LOG_ROOT, f"{name}_{datetime.now().strftime('%Y%m%d')}.log")


    file_handler = RotatingFileHandler(log_file, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8")
    file_handler.setLevel(file_level)
    file_handler.setFormatter(DEFAULT_LOG_FORMAT)
    logger.addHandler(file_handler)

    return logger

# 快捷获取日志器
logger = get_logger()

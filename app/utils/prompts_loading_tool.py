from app.utils.config_loading_tool import prompts_config
from app.utils.path_tool import get_abs_path
from app.utils.logger_tool import logger

def load_system_prompt():
    try:
        system_prompt_path = get_abs_path(prompts_config["system_prompt_path"])
    except KeyError as e:
        logger.error(f"[load_system_prompt]在yaml配置中没有system_prompt_path配置项")
        raise e

    try:
        return open(system_prompt_path, "r", encoding="utf-8").read()
    except Exception as e:
        logger.error(f"[load_system_prompt]解析系统提示词出错，{str(e)}")
        raise e


def load_rag_prompt():
    try:
        rag_prompt_path = get_abs_path(prompts_config["rag_prompt_path"])
    except KeyError as e:
        logger.error(f"[load_rag_prompt]在yaml配置中没有rag_prompt_path配置项")
        raise e

    try:
        return open(rag_prompt_path, "r", encoding="utf-8").read()
    except Exception as e:
        logger.error(f"[load_rag_prompt]解析rag提示词出错，{str(e)}")
        raise e


def load_report_prompt():
    try:
        report_prompt_path = get_abs_path(prompts_config["report_prompt_path"])
    except KeyError as e:
        logger.error(f"[load_report_prompt]在yaml配置中没有report_prompt_path配置项")
        raise e

    try:
        return open(report_prompt_path, "r", encoding="utf-8").read()
    except Exception as e:
        logger.error(f"[load_report_prompt]解析report提示词出错，{str(e)}")
        raise e

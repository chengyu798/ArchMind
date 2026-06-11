"""为整个项目提供一个统一的绝对路径"""

import os

def get_project_root() -> str:
    """
    获取项目的根目录
    :return: 根目录地址
    """
    # 当前文件的绝对路径
    current_file = os.path.abspath(__file__)
    # 获取工程的根目录,先获取当前文件的目录
    current_dir = os.path.dirname(current_file)
    # 获取项目根目录
    project_root = os.path.dirname(current_dir)
    return project_root

def get_abs_path(relative_path: str) -> str:
    """
    给定相对路径返回绝对路径
    :param relative_path:
    :return: 返回绝对路径
    """
    project_root = get_project_root()
    abs_path = os.path.join(project_root, relative_path)
    return abs_path

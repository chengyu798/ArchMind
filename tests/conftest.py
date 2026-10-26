"""自动化测试始终使用临时运行目录和测试密钥。"""
import pytest


@pytest.fixture(scope="session", autouse=True)
def isolated_application_runtime(tmp_path_factory):
    from app.utils import path_tool

    sandbox = tmp_path_factory.mktemp("application-runtime")
    original_path = path_tool.get_abs_path
    patch = pytest.MonkeyPatch()
    patch.setenv("DASHSCOPE_API_KEY", "test-only-key")
    patch.setenv("JWT_SECRET_KEY", "test-only-jwt-secret-for-isolated-tests")
    patch.setattr(
        path_tool,
        "get_abs_path",
        lambda path: str(sandbox / path) if path.startswith(("data/", "logs/")) else original_path(path),
    )
    yield
    patch.undo()

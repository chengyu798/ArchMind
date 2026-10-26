"""由已鉴权的服务层创建，每次 Agent 执行独立持有的可信上下文。"""
from dataclasses import dataclass


@dataclass(frozen=True)
class AgentContext:
    user_id: int
    report: bool = False
    session_id: int | None = None
    user_message_id: int | None = None

    def __post_init__(self) -> None:
        if type(self.user_id) is not int or self.user_id <= 0:
            raise ValueError("Agent 上下文必须包含有效的登录用户 ID")
        for value in (self.session_id, self.user_message_id):
            if value is not None and (type(value) is not int or value <= 0):
                raise ValueError("会话和消息 ID 必须是正整数")
        if self.user_message_id is not None and self.session_id is None:
            raise ValueError("消息上下文必须绑定会话")

"""Shared model input construction for generation and occupancy estimates."""
GUIDANCE = "如果问题需要参考用户文件，请调用 search_user_knowledge 工具，只提供检索问题；用户身份由系统绑定。若知识库没有检索到相关内容，或用户明确要求查询公开网络信息，请调用 search_web，并将网络搜索结果与用户问题结合后回答。需要核对之前对话的细节时调用 search_conversation_history，引用历史记录时使用 [M消息ID] 标记。"


def build_messages(history, query, memory=""):
    messages = [{"role": item["role"], "content": item["content"]} for item in history or [] if item.get("role") in {"user", "assistant"} and item.get("content")]
    memory_context = f"\n长期记忆：\n{memory}\n" if memory else ""
    return messages + [{"role": "user", "content": f"{memory_context}用户问题：{query}\n{GUIDANCE}"}]

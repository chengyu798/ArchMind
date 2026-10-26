"""Owner/session-scoped original conversation and tool evidence lookup."""
import re
from fastapi import HTTPException
from sqlalchemy import select
from app.db.models import ChatSession, ChatToolRecord, Message
from app.agent.context_budget import count_text, load_context_policy, serialize


def own_session(db, user_id, session_id):
    session = db.scalar(select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user_id))
    if session is None:
        raise HTTPException(404, "会话不存在")
    return session


def message_view(message):
    return {"id": message.id, "role": message.role, "content": message.content, "created_at": message.created_at.isoformat(), "token_usage": message.token_usage}


def lookup_history(db, user_id, session_id, query="", message_id=None, limit=5, full=False):
    own_session(db, user_id, session_id)
    if message_id is not None:
        anchor = db.scalar(select(Message).where(Message.id == message_id, Message.session_id == session_id))
        if anchor is None:
            raise HTTPException(404, "消息不存在")
        before = list(reversed(db.scalars(select(Message).where(Message.session_id == session_id, Message.id < message_id).order_by(Message.id.desc()).limit(1)).all()))
        after = db.scalars(select(Message).where(Message.session_id == session_id, Message.id > message_id).order_by(Message.id).limit(1)).all()
        messages = before + [anchor] + list(after)
    else:
        terms = list(dict.fromkeys(re.findall(r"[\w\u4e00-\u9fff]+", query[:300])))[:12]
        if not terms:
            return {"messages": [], "tools": [], "truncated": False}
        # Parameterized LIKE, not user-provided SQL/FTS expressions.
        matches = []
        from sqlalchemy import or_
        for term in list(terms):
            if len(term) > 4 and any('\u4e00' <= char <= '\u9fff' for char in term):
                terms.extend(term[index:index + 2] for index in range(0, min(len(term)-1, 16), 2))
        predicate = or_(*(Message.content.contains(term, autoescape=True) for term in terms[:24]))
        candidates = db.scalars(select(Message).where(Message.session_id == session_id, predicate).order_by(Message.id.desc()).limit(100)).all()
        candidates.sort(key=lambda item: (sum(term.lower() in item.content.lower() for term in terms), item.id), reverse=True)
        messages = sorted(candidates[:min(limit, 10)], key=lambda item: item.id)
    results = []; truncated = False; budget = load_context_policy().history_result_tokens
    for message in messages:
        view = message_view(message)
        if not full and count_text(view['content']) > budget:
            text = view['content']; low, high = 0, len(text)
            while low < high:
                mid = (low + high + 1) // 2
                if count_text(text[:mid]) <= max(0, budget): low = mid
                else: high = mid - 1
            view['content'] = text[:low] + '…'; truncated = True
        cost = count_text(view['content'])
        if not full and budget <= 0: truncated = True; break
        results.append(view); budget -= cost
    ids = [message['id'] for message in results]
    records = db.scalars(select(ChatToolRecord).where(ChatToolRecord.session_id == session_id, ChatToolRecord.user_id == user_id, ChatToolRecord.user_message_id.in_(ids)).order_by(ChatToolRecord.id).limit(10)).all() if ids else []
    tools = []
    for record in records:
        result = record.result
        if not full and count_text(result) > max(0, budget):
            result = '完整工具结果已存档，可通过历史原文入口查看。'; truncated = True
        if not full and budget <= 0: truncated = True; break
        tools.append({"id": record.id, "user_message_id": record.user_message_id, "name": record.tool_name, "arguments": record.arguments, "result": result, "status": record.status})
        budget -= count_text(result)
    response = {"messages": results, "tools": tools, "truncated": truncated}
    if not full:
        # Account for metadata and arguments as well as message/result text.
        maximum = load_context_policy().history_result_tokens
        while count_text(serialize(response)) > maximum:
            response['truncated'] = True
            if response['tools']: response['tools'].pop(); continue
            if not response['messages']: break
            last = response['messages'][-1]
            if len(last['content']) > 80: last['content'] = last['content'][:len(last['content']) // 2] + '…'
            else: response['messages'].pop()
    return response

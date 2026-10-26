"""Deterministic small-window tests for a production 1M context policy."""
from dataclasses import replace
from datetime import datetime, timedelta, UTC
from types import SimpleNamespace
from uuid import uuid4
import json

import pytest
from fastapi import HTTPException, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture(scope='module', autouse=True)
def isolated_context_runtime(tmp_path_factory):
    from app.utils import path_tool
    patch = pytest.MonkeyPatch(); sandbox = tmp_path_factory.mktemp('context-runtime'); original = path_tool.get_abs_path
    patch.setenv('DASHSCOPE_API_KEY', 'test-only-key'); patch.setenv('JWT_SECRET_KEY', 'context-tests-only-secret')
    patch.setattr(path_tool, 'get_abs_path', lambda path: str(sandbox / path) if path.startswith(('data/', 'logs/')) else original(path))
    yield
    patch.undo()


@pytest.fixture
def env(monkeypatch):
    from app.db.database import Base, get_db
    from app.db.models import ChatSession, Message, User, SessionContextSummary
    from app.services import context_service as service, chat_service
    from app.agent.context_budget import ContextPolicy
    from app.api.routes.chat import router
    from app.auth.jwt import create_access_token
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    sessions = sessionmaker(engine, expire_on_commit=False); Base.metadata.create_all(engine)
    with sessions() as db:
        users = [User(username=f'context-{i}', nickname=f'用户{i}', hashed_password='unused') for i in range(2)]
        db.add_all(users); db.flush(); chats = [ChatSession(user_id=user.id, title='context test') for user in users]
        db.add_all(chats); db.commit()
        for i in range(24): db.add(Message(session_id=chats[0].id, role='user' if i % 2 == 0 else 'assistant', content=f'资料{i}，金额12345，保持历史原文。' + 'abcdef' * 100))
        db.add(Message(session_id=chats[1].id, role='user', content='OTHER_USER_SECRET')); db.commit()
    policy = ContextPolicy(context_window=20000, output_tokens=1000, safety_tokens=200, summary_max_tokens=800)
    monkeypatch.setattr(service, 'load_context_policy', lambda: policy)
    # Character units make boundary placement deterministic; real tokenizer has separate tests.
    monkeypatch.setattr(service, 'estimate', lambda history, *args, **kwargs: len(json.dumps(history, ensure_ascii=False)))
    calls = []
    def generate(previous, messages, tools, policy):
        calls.append([item.id for item in messages])
        item = {'id': 'goal-1', 'text': '保留金额12345并完成任务', 'status': 'active', 'verification': 'user_confirmed', 'source_message_ids': [messages[0].id]}
        data = {'goals': [item], 'constraints': [], 'facts': [], 'decisions': [], 'work_state': {'completed': [], 'pending': [], 'open_questions': []}}
        return data, {'input_tokens': 10, 'output_tokens': 5, 'total_tokens': 15, 'model_calls': 1, 'reported_calls': 1}, 'fake-summary'
    monkeypatch.setattr(service, 'generate_summary', generate); monkeypatch.setattr(chat_service, 'SessionLocal', sessions)
    app = FastAPI(); app.include_router(router, prefix='/api')
    def test_db():
        with sessions() as db: yield db
    app.dependency_overrides[get_db] = test_db
    headers = [{'Authorization': 'Bearer ' + create_access_token(str(user.id))} for user in users]
    with TestClient(app) as client:
        yield SimpleNamespace(service=service, sessions=sessions, users=users, chats=chats, policy=policy, calls=calls, generate=generate, client=client, headers=headers, Summary=SessionContextSummary, Message=Message, Chat=ChatSession)
    engine.dispose()


def prepare(env, db):
    token = env.service.acquire_lease(db, env.users[0].id, env.chats[0].id)
    last = db.scalar(select(env.Message).where(env.Message.session_id == env.chats[0].id).order_by(env.Message.id.desc()).limit(1))
    return env.service.prepare_context(db, env.users[0].id, env.chats[0].id, last.id + 1, '当前问题不能丢', '', token), token


def test_production_policy_and_official_local_tokenizer():
    from app.agent.context_budget import load_context_policy, count_text, count_input, tokenizer
    policy = load_context_policy()
    assert policy.context_window == 1048576 and policy.trigger_ratio == .5
    assert (policy.target_min_ratio, policy.target_max_ratio) == (.2, .3)
    assert 0 < count_text('上下文 engineering 12345') < 100
    assert count_text('') == 0 and tokenizer().truncation is None
    assert count_input([{'role': 'user', 'content': 'test'}]) > count_text('test')


@pytest.mark.parametrize('offset', [-1, 0, 1])
def test_exact_trigger_boundary(env, monkeypatch, offset):
    def estimate(history, *args, **kwargs):
        return 1000 if history and '结构化资料摘要' in history[0]['content'] else int(env.policy.context_window * .5) + offset
    monkeypatch.setattr(env.service, 'estimate', estimate)
    with env.sessions() as db:
        (history, usage, warning), token = prepare(env, db)
        assert bool(env.calls) is (offset >= 0)
        env.service.release_lease(db, env.chats[0].id, token)


def test_compaction_preserves_originals_versions_and_complete_recent_turns(env):
    with env.sessions() as db:
        original = [(item.id, item.content) for item in env.service.raw_messages(db, env.chats[0].id)]
        (history, usage, warning), token = prepare(env, db)
        assert warning is None and usage['total_tokens'] == 15
        assert '结构化资料摘要' in history[0]['content'] and history[2]['role'] == 'user'
        summary = db.scalar(select(env.Summary).where(env.Summary.status == 'ready'))
        assert summary.context_tokens_after < .30 * env.policy.context_window
        assert summary.context_tokens_before > .5 * env.policy.context_window
        assert original == [(item.id, item.content) for item in env.service.raw_messages(db, env.chats[0].id)]
        env.service.release_lease(db, env.chats[0].id, token)
    with env.sessions() as db:
        status = env.service.status_view(db, env.users[0].id, env.chats[0].id)
        assert status['active_summary']['version'] == 1


@pytest.mark.parametrize('failure', ['model', 'source', 'schema', 'duplicate'])
def test_invalid_summary_never_replaces_active_state(env, monkeypatch, failure):
    def invalid(*args):
        if failure == 'model': raise env.service.SummaryFailed('test', {'model_calls': 1, 'reported_calls': 0, 'input_tokens': None, 'output_tokens': None, 'total_tokens': None})
        data, usage, name = env.generate(*args)
        if failure == 'source': data['goals'][0]['source_message_ids'] = [999999]
        if failure == 'schema': data['unexpected'] = 'not allowed'
        if failure == 'duplicate': data['facts'] = data['goals']
        return data, usage, name
    monkeypatch.setattr(env.service, 'generate_summary', invalid)
    with env.sessions() as db:
        (history, usage, warning), token = prepare(env, db)
        assert warning and '结构化资料摘要' not in history[0]['content']
        assert db.get(env.Chat, env.chats[0].id).active_summary_version == 0
        assert db.scalar(select(env.Summary)).status == 'failed'
        assert len(env.service.raw_messages(db, env.chats[0].id)) == 24
        env.service.release_lease(db, env.chats[0].id, token)


def test_second_compaction_is_incremental_and_tracks_parent(env):
    with env.sessions() as db:
        (_, _, _), token = prepare(env, db)
        first = db.scalar(select(env.Summary).where(env.Summary.status == 'ready')); cutoff = first.covered_through_message_id
        env.service.release_lease(db, env.chats[0].id, token)
        for index in range(24): db.add(env.Message(session_id=env.chats[0].id, role='user' if index % 2 == 0 else 'assistant', content='新增资料' + 'abcdef' * 100))
        db.commit(); (_, _, warning), token = prepare(env, db)
        assert warning is None
        second = db.scalar(select(env.Summary).where(env.Summary.version == 2))
        assert second.previous_summary_id == first.id and second.covered_through_message_id > cutoff
        assert all(mid > cutoff for mid in env.calls[1])
        env.service.release_lease(db, env.chats[0].id, token)


def test_source_edit_invalidates_summary(env):
    with env.sessions() as db:
        (_, _, _), token = prepare(env, db); env.service.release_lease(db, env.chats[0].id, token)
        message = env.service.raw_messages(db, env.chats[0].id)[0]; message.content = '已修改'; db.commit()
        state = env.service.status_view(db, env.users[0].id, env.chats[0].id)
        assert state['active_summary'] is None and state['last_compaction']['status'] == 'invalidated'


def test_session_lease_blocks_parallel_turns_and_stale_workers(env):
    with env.sessions() as db:
        token = env.service.acquire_lease(db, env.users[0].id, env.chats[0].id)
        with pytest.raises(HTTPException) as error: env.service.acquire_lease(db, env.users[0].id, env.chats[0].id)
        assert error.value.status_code == 409
        env.service.release_lease(db, env.chats[0].id, 'wrong-token')
        assert db.get(env.Chat, env.chats[0].id).context_lease == token
        env.service.release_lease(db, env.chats[0].id, token)
        from app.agent.context_budget import ContextCapacityError
        with pytest.raises(ContextCapacityError): env.service.renew_lease(db, env.users[0].id, env.chats[0].id, token)


def test_expired_lease_can_be_recovered(env):
    with env.sessions() as db:
        session = db.get(env.Chat, env.chats[0].id); session.context_lease = 'expired'; session.context_lease_until = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1); db.commit()
        token = env.service.acquire_lease(db, env.users[0].id, env.chats[0].id)
        assert token != 'expired'; env.service.release_lease(db, env.chats[0].id, token)


@pytest.mark.parametrize('route', ['context', 'context/summaries', 'history?query=SECRET'])
def test_context_routes_are_owner_scoped(env, route):
    response = env.client.get(f'/api/chat/sessions/{env.chats[1].id}/{route}', headers=env.headers[0])
    assert response.status_code == 404 and 'OTHER_USER_SECRET' not in response.text


def test_history_search_and_anchor_do_not_cross_sessions(env):
    base = f'/api/chat/sessions/{env.chats[0].id}/history'
    result = env.client.get(base + '?query=金额12345', headers=env.headers[0]).json()
    assert result['messages'] and 'OTHER_USER_SECRET' not in str(result)
    with env.sessions() as db: foreign = env.service.raw_messages(db, env.chats[1].id)[0]
    assert env.client.get(base + f'?message_id={foreign.id}', headers=env.headers[0]).status_code == 404
    mid = result['messages'][0]['id']
    expanded = env.client.get(base + f'?message_id={mid}', headers=env.headers[0]).json()
    assert any(message['id'] == mid for message in expanded['messages'])


def test_guard_counts_tool_schema_and_preserves_messages():
    from app.agent import context_budget as budget
    from langchain.agents.middleware import ModelRequest
    from langchain_core.messages import HumanMessage
    request = ModelRequest(model=SimpleNamespace(model_name='deepseek-v4-flash'), messages=[HumanMessage(content='hello')])
    modified = budget.guarded_request(request)
    assert modified.model_settings['max_tokens'] == 65536 and modified.messages == request.messages
    with pytest.raises(budget.ContextCapacityError): budget.check_capacity(1001, budget.ContextPolicy(context_window=2000, output_tokens=900, safety_tokens=100))
    budget.check_capacity(1000, budget.ContextPolicy(context_window=2000, output_tokens=900, safety_tokens=100))


def test_database_migration_preserves_legacy_sessions_and_is_idempotent(monkeypatch):
    from app.db import database
    engine = create_engine('sqlite://')
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE sessions (id INTEGER PRIMARY KEY, title TEXT)')); conn.execute(text("INSERT INTO sessions VALUES (1, 'old')"))
    monkeypatch.setattr(database, 'engine', engine)
    database._ensure_context_columns(); database._ensure_context_columns()
    with engine.connect() as conn: assert conn.execute(text('SELECT title, context_version, active_summary_version FROM sessions')).one() == ('old', 0, 0)
    assert {'context_lease','context_lease_until'} <= {column['name'] for column in inspect(engine).get_columns('sessions')}
    engine.dispose()


def test_full_history_no_longer_truncates_messages(env):
    from app.services.chat_service import build_recent_history
    with env.sessions() as db:
        messages = env.service.raw_messages(db, env.chats[0].id)
        messages[0].content = 'X' * 5000
        history = build_recent_history(messages)
        assert len(history) == 24 and len(history[0]['content']) == 5000


def test_prior_confirmed_constraints_survive_summary_model_omission(env):
    item = {'id': 'c1', 'text': '不得删除原文', 'status': 'active', 'verification': 'user_confirmed', 'source_message_ids': [1]}
    with env.sessions() as db:
        messages = env.service.raw_messages(db, env.chats[0].id)
        old = SimpleNamespace(content={'goals': [], 'constraints': [item], 'facts': [], 'decisions': [], 'work_state': {'completed': [], 'pending': [], 'open_questions': []}})
        new = {'goals': [], 'constraints': [], 'facts': [], 'decisions': [], 'work_state': {'completed': [], 'pending': [], 'open_questions': []}}
        assert env.service.validate_summary(new, old, messages, db, env.users[0].id).constraints[0].text == '不得删除原文'


def test_summary_and_answer_usage_are_accounted_once_in_sync_and_stream(env, monkeypatch):
    from app.services import chat_service
    from app.agent.token_usage import merge_usage
    answer_usage = {'input_tokens': 4, 'output_tokens': 3, 'total_tokens': 7, 'model_calls': 1, 'reported_calls': 1}
    def answer(*args, **kwargs):
        assert '结构化资料摘要' in args[2][0]['content']
        yield {'type': 'message', 'content': '预算12345元 [M1]'}
        yield {'type': 'usage', 'usage': answer_usage}
    monkeypatch.setattr(chat_service.user_agent_service, 'stream_events', answer)
    response = env.client.post(f'/api/chat/sessions/{env.chats[0].id}/messages/stream', headers=env.headers[0], json={'content': '继续'})
    assert response.status_code == 200 and 'event: error' not in response.text
    assert 'event: context_status' in response.text
    done = next(json.loads(block.split('data: ')[1]) for block in response.text.split('\n\n') if block.startswith('event: done'))
    assert done['token_usage']['total_tokens'] == 22
    assert done['token_usage']['model_calls'] == 2
    assert done['usage_breakdown']['compaction']['total_tokens'] == 15
    with env.sessions() as db: assert db.get(env.Chat, env.chats[0].id).context_lease is None


def test_summary_call_has_no_inherited_answer_callbacks(env, monkeypatch):
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langchain_core.runnables import RunnableLambda
    from app.agent.token_usage import TokenUsageCollector
    from app.models import factory
    from app.services.context_service import generate_summary
    with env.sessions() as db:
        messages = env.service.raw_messages(db, env.chats[0].id)[:2]
        data, _, _ = env.generate(None, messages, [], env.policy)
    class SummaryModel(BaseChatModel):
        @property
        def _llm_type(self): return 'isolated-summary-test'
        def _generate(self, messages, **kwargs):
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content=json.dumps(data), usage_metadata={'input_tokens': 10, 'output_tokens': 5, 'total_tokens': 15}))])
    monkeypatch.setattr(factory.ChatModelFactory, 'generator', lambda self: SummaryModel())
    outer = TokenUsageCollector()
    result = RunnableLambda(lambda _: generate_summary(None, messages, [], env.policy)).invoke(None, config={'callbacks': [outer]})
    assert result[1]['total_tokens'] == 15 and outer.summary()['model_calls'] == 0


def test_stale_summary_cannot_publish_over_new_context_version(env, monkeypatch):
    def stale(*args):
        data = env.generate(*args)
        with env.sessions() as other:
            session = other.get(env.Chat, env.chats[0].id); session.context_version += 1; other.commit()
        return data
    monkeypatch.setattr(env.service, 'generate_summary', stale)
    with env.sessions() as db:
        (_, _, warning), token = prepare(env, db)
        assert warning
        db.expire_all(); session = db.get(env.Chat, env.chats[0].id)
        assert session.active_summary_version == 0 and session.context_version == 1
        env.service.release_lease(db, env.chats[0].id, token)


def test_expired_build_is_marked_failed_before_retry(env):
    with env.sessions() as db:
        db.add(env.Summary(user_id=env.users[0].id, session_id=env.chats[0].id, version=1, covered_through_message_id=1, status='building'))
        db.commit(); token = env.service.acquire_lease(db, env.users[0].id, env.chats[0].id)
        assert db.scalar(select(env.Summary)).status == 'failed'
        env.service.release_lease(db, env.chats[0].id, token)


def test_session_deletion_cleans_context_records_and_blocks_active_turn(env):
    with env.sessions() as db:
        (_, _, _), token = prepare(env, db)
    url = f'/api/chat/sessions/{env.chats[0].id}'
    assert env.client.delete(url, headers=env.headers[0]).status_code == 409
    with env.sessions() as db: env.service.release_lease(db, env.chats[0].id, token)
    assert env.client.delete(url, headers=env.headers[0]).status_code == 204
    with env.sessions() as db:
        assert db.scalar(select(env.Summary).where(env.Summary.session_id == env.chats[0].id)) is None
        assert env.service.raw_messages(db, env.chats[0].id) == []
        assert env.service.raw_messages(db, env.chats[1].id)


def test_superseded_constraints_cannot_stay_active(env):
    base = {'id': 'old', 'text': '旧要求', 'status': 'active', 'verification': 'user_stated', 'source_message_ids': [1]}
    new = {**base, 'id': 'new', 'text': '新要求', 'supersedes': ['old']}
    data = {'goals': [], 'constraints': [base, new], 'facts': [], 'decisions': [], 'work_state': {'completed': [], 'pending': [], 'open_questions': []}}
    with env.sessions() as db:
        parsed = env.service.validate_summary(data, None, env.service.raw_messages(db, env.chats[0].id), db, env.users[0].id)
        assert parsed.constraints[0].status == 'superseded' and parsed.constraints[1].status == 'active'


def test_nested_tool_loop_can_compact_without_splitting_tool_pair(env, monkeypatch):
    from app.agent.context_budget import ContextPolicy
    from app.agent.execution import ChatExecution, bind_execution
    from app.agent import middleware
    from langchain.agents import create_agent
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage, ToolMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langchain_core.tools import tool
    @tool
    def local_evidence() -> str:
        """Return local test evidence."""
        return '工具原文证据'
    class Model(BaseChatModel):
        model_name: str = 'deepseek-v4-flash'
        @property
        def _llm_type(self): return 'context-tool-loop'
        def bind_tools(self, tools, **kwargs): return self
        def _generate(self, messages, **kwargs):
            final = isinstance(messages[-1], ToolMessage)
            # The call and result must remain together even after prefix replacement.
            if final: assert any(getattr(message, 'tool_calls', None) for message in messages)
            answer = AIMessage(content='完成' if final else '', tool_calls=[] if final else [{'id': 'call-test', 'name': 'local_evidence', 'args': {}}])
            return ChatResult(generations=[ChatGeneration(message=answer)])
    graph = create_agent(Model(), [local_evidence], middleware=[middleware.monitor_tool, middleware.report_prompt_switch])
    monkeypatch.setattr(middleware, 'count_input', lambda *args: 600000)
    calls = []
    original = [{'role': 'user', 'content': '旧问题'}, {'role': 'assistant', 'content': '旧回答'}]
    execution = ChatExecution(env.chats[0].id, 1, env.sessions, '')
    execution.history = original
    execution.prepare = lambda *args: (calls.append(args) or [{'role': 'user', 'content': '旧摘要'}, {'role': 'assistant', 'content': '已读取'}], None, None)
    from app.agent.context import AgentContext
    with env.sessions() as db: execution.lease = env.service.acquire_lease(db, env.users[0].id, env.chats[0].id)
    with bind_execution(execution):
        result = graph.invoke({'messages': original + [{'role': 'user', 'content': '继续'}]}, context=AgentContext(user_id=env.users[0].id, session_id=env.chats[0].id, user_message_id=1))
    assert result['messages'][-1].content == '完成' and len(calls) == 2
    with env.sessions() as db:
        from app.db.models import ChatToolRecord
        record = db.scalar(select(ChatToolRecord)); assert record.tool_name == 'local_evidence' and record.result == '工具原文证据'
        env.service.release_lease(db, env.chats[0].id, execution.lease)


def test_source_change_during_generation_prevents_publication(env, monkeypatch):
    def edit_source(*args):
        result = env.generate(*args)
        with env.sessions() as other:
            message = other.get(env.Message, 1); message.content = '生成期间已修改'; other.commit()
        return result
    monkeypatch.setattr(env.service, 'generate_summary', edit_source)
    with env.sessions() as db:
        (_, _, warning), token = prepare(env, db)
        assert warning
        assert db.get(env.Chat, env.chats[0].id).active_summary_version == 0
        env.service.release_lease(db, env.chats[0].id, token)


def test_history_tool_budget_includes_json_metadata(env, monkeypatch):
    from app.services import history_service
    from app.agent.context_budget import serialize, count_text
    monkeypatch.setattr(history_service, 'load_context_policy', lambda: replace(env.policy, history_result_tokens=160))
    with env.sessions() as db:
        result = history_service.lookup_history(db, env.users[0].id, env.chats[0].id, '金额')
        assert count_text(serialize(result)) <= 160 and result['truncated']

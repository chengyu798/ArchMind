"""Provider usage normalization, request isolation, persistence and stream contracts."""
import json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from uuid import uuid4

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult, LLMResult
from langchain_core.tools import tool
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.agent.token_usage import TokenUsageCollector, normalize_usage


@pytest.fixture(scope='module', autouse=True)
def isolated_usage_runtime(tmp_path_factory):
    from app.utils import path_tool
    sandbox = tmp_path_factory.mktemp('usage-runtime')
    original = path_tool.get_abs_path
    patch = pytest.MonkeyPatch()
    patch.setenv('DASHSCOPE_API_KEY', 'test-only-key')
    patch.setenv('JWT_SECRET_KEY', 'test-only-jwt-secret-for-token-usage')
    patch.setattr(path_tool, 'get_abs_path', lambda path: str(sandbox / path) if path.startswith(('data/', 'logs/')) else original(path))
    yield
    patch.undo()


def result(usage=None, *, info=None, output=None):
    return LLMResult(generations=[[ChatGeneration(message=AIMessage(content='ok', usage_metadata=usage), generation_info=info)]], llm_output=output)


def test_provider_formats_and_invalid_counts():
    assert normalize_usage({'prompt_tokens': 12, 'completion_tokens': 4}) == {'input_tokens': 12, 'output_tokens': 4, 'total_tokens': 16}
    assert normalize_usage({'input_tokens': 0, 'output_tokens': 0, 'total_tokens': 0}) == {'input_tokens': 0, 'output_tokens': 0, 'total_tokens': 0}
    assert normalize_usage({'input_tokens': -1, 'output_tokens': True, 'total_tokens': '10'}) is None


@pytest.mark.parametrize('location', ['standard', 'generation', 'output'])
def test_provider_usage_is_read_from_integration_metadata(location):
    callback = TokenUsageCollector()
    standard = {'input_tokens': 8, 'output_tokens': 3, 'total_tokens': 11}
    raw = {'input_tokens': 8, 'output_tokens': 3, 'total_tokens': 11}
    response = result(standard if location == 'standard' else None, info={'token_usage': raw} if location == 'generation' else None, output={'token_usage': raw} if location == 'output' else None)
    callback.on_llm_end(response, run_id=uuid4())
    assert callback.summary() == {**standard, 'model_calls': 1, 'reported_calls': 1}


def test_duplicate_callback_and_metadata_copies_are_not_double_counted():
    callback = TokenUsageCollector(); run_id = uuid4()
    response = result({'input_tokens': 8, 'output_tokens': 2, 'total_tokens': 10}, info={'token_usage': {'input_tokens': 8, 'output_tokens': 2, 'total_tokens': 10}})
    for _ in range(2): callback.on_llm_end(response, run_id=run_id)
    assert callback.summary()['total_tokens'] == 10
    assert callback.summary()['model_calls'] == 1


def test_missing_or_failed_invocation_is_not_reported_as_zero_or_complete_total():
    callback = TokenUsageCollector()
    callback.on_llm_end(result({'input_tokens': 8, 'output_tokens': 2, 'total_tokens': 10}), run_id=uuid4())
    callback.on_llm_error(RuntimeError('upstream failed'), run_id=uuid4())
    assert callback.summary() == {'input_tokens': None, 'output_tokens': None, 'total_tokens': None, 'model_calls': 2, 'reported_calls': 1}
    assert TokenUsageCollector().summary()['total_tokens'] is None


def test_parallel_requests_do_not_share_usage():
    def collect(count):
        callback = TokenUsageCollector()
        for _ in range(count): callback.on_llm_end(result({'input_tokens': 8, 'output_tokens': 2, 'total_tokens': 10}), run_id=uuid4())
        return callback.summary()['total_tokens']
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert list(executor.map(collect, [1, 4])) == [10, 40]


@pytest.fixture
def chat_env(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.routes.chat import router
    from app.auth.jwt import create_access_token
    from app.db.database import Base, get_db
    from app.db.models import ChatSession, Message, User
    from app.services import chat_service

    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    sessions = sessionmaker(engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    with sessions() as db:
        user = User(username='usage-test', nickname='用量测试', hashed_password='not-used')
        db.add(user); db.flush()
        session = ChatSession(user_id=user.id, title='Token test'); db.add(session); db.commit()
        user_id, session_id = user.id, session.id
    monkeypatch.setattr(chat_service, 'SessionLocal', sessions)
    app = FastAPI(); app.include_router(router, prefix='/api')
    def get_test_db():
        with sessions() as db: yield db
    app.dependency_overrides[get_db] = get_test_db
    headers = {'Authorization': 'Bearer ' + create_access_token(str(user_id))}
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, headers=headers, session_id=session_id, user_id=user_id, service=chat_service, sessions=sessions, Message=Message)
    engine.dispose()


@pytest.mark.parametrize('streaming', [False, True])
def test_usage_is_returned_and_persisted_on_assistant_only(chat_env, monkeypatch, streaming):
    usage = {'input_tokens': 21, 'output_tokens': 7, 'total_tokens': 28, 'model_calls': 2, 'reported_calls': 2}
    def events(*args, **kwargs):
        yield {'type': 'message', 'content': '测试完成'}
        yield {'type': 'usage', 'usage': usage}
    monkeypatch.setattr(chat_env.service.user_agent_service, 'stream_events', events)
    path = f'/api/chat/sessions/{chat_env.session_id}'
    response = chat_env.client.post(path + '/messages' + ('/stream' if streaming else ''), headers=chat_env.headers, json={'content': '测试'})
    assert response.status_code in (200, 201), response.text
    if streaming:
        completion = [json.loads(block.split('data: ')[1]) for block in response.text.split('\n\n') if block.startswith('event: done')][0]
        assert completion['token_usage'] == usage and completion['message_id'] > 0
    else:
        assert response.json()['messages'][-1]['token_usage'] == usage
    history = chat_env.client.get(path, headers=chat_env.headers).json()['messages']
    assert history[-1]['token_usage'] == usage and history[-2]['token_usage'] is None


def test_usage_survives_stream_failure_without_claiming_a_successful_answer(chat_env, monkeypatch):
    usage = {'input_tokens': 5, 'output_tokens': 2, 'total_tokens': 7, 'model_calls': 1, 'reported_calls': 1}
    def events(*args, **kwargs):
        yield {'type': 'message', 'content': '部分输出'}
        yield {'type': 'usage', 'usage': usage}
        raise RuntimeError('test failure')
    monkeypatch.setattr(chat_env.service.user_agent_service, 'stream_events', events)
    response = chat_env.client.post(f'/api/chat/sessions/{chat_env.session_id}/messages/stream', headers=chat_env.headers, json={'content': '测试'})
    assert 'event: error' in response.text and 'event: done' not in response.text
    history = chat_env.client.get(f'/api/chat/sessions/{chat_env.session_id}', headers=chat_env.headers).json()['messages']
    assert history[-1]['token_usage'] == usage and '错误' in history[-1]['content']


def test_usage_aggregation_through_real_agent_tool_loop(monkeypatch):
    from langchain.agents import create_agent
    from app.agent import agent as agent_module

    @tool
    def echo(query: str) -> str:
        """Return a local test value."""
        return query

    class UsageModel(BaseChatModel):
        @property
        def _llm_type(self): return 'usage-test'
        def bind_tools(self, tools, **kwargs): return self
        def _generate(self, messages, **kwargs):
            final = isinstance(messages[-1], ToolMessage)
            message = AIMessage(content='完成' if final else '', tool_calls=[] if final else [{'name': 'echo', 'args': {'query': 'local'}, 'id': 'echo-1'}], usage_metadata={'input_tokens': 10, 'output_tokens': 3, 'total_tokens': 13})
            return ChatResult(generations=[ChatGeneration(message=message)])

    graph = create_agent(UsageModel(), tools=[echo])
    if hasattr(agent_module, 'get_chat_runtime'):
        monkeypatch.setattr(agent_module, 'get_chat_runtime', lambda: SimpleNamespace(agent=graph))
    else:
        monkeypatch.setattr(agent_module, 'create_agent', lambda **kwargs: graph)
    events = list(agent_module.UserAgentService().stream_events('test', 1))
    usage = next(event['usage'] for event in events if event['type'] == 'usage')
    assert usage == {'input_tokens': 20, 'output_tokens': 6, 'total_tokens': 26, 'model_calls': 2, 'reported_calls': 2}


def test_legacy_database_migration_is_additive_idempotent_and_preserves_messages(monkeypatch):
    from app.db import database
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE messages (id INTEGER PRIMARY KEY, content TEXT)'))
        connection.execute(text("INSERT INTO messages VALUES (1, 'old answer')"))
    monkeypatch.setattr(database, 'engine', engine)
    database._ensure_message_columns(); database._ensure_message_columns()
    assert 'token_usage' in {column['name'] for column in inspect(engine).get_columns('messages')}
    with engine.connect() as connection: assert connection.execute(text('SELECT content, token_usage FROM messages')).one() == ('old answer', None)
    engine.dispose()

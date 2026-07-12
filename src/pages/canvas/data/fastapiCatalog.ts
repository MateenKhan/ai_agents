// Exhaustive FastAPI option catalog (including the Python AI/LLM ecosystem) for the
// canvas inspector. FastAPI entries are sourced from the official docs navigation at
// https://fastapi.tiangolo.com; ecosystem entries link to each project's own official
// documentation (SQLAlchemy, Celery, vLLM, LangChain, etc.). Data-only, safe to lazy-load.

import type { FrameworkCatalog } from './catalogTypes';

export const FASTAPI_CATALOG: FrameworkCatalog = {
  framework: 'fastapi',
  label: 'FastAPI Async & AI Stack',
  categories: [
    {
      id: 'core-framework',
      label: 'Core Framework',
      options: [
        {
          id: 'path-operations',
          label: 'Path Operations',
          description: 'Declare typed endpoints with decorators like @app.get and automatic docs.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/first-steps/',
        },
        {
          id: 'pydantic-v2',
          label: 'Pydantic v2',
          description: 'Rust-core data validation and serialization library powering all FastAPI models.',
          docsUrl: 'https://docs.pydantic.dev/latest/',
        },
        {
          id: 'request-body-models',
          label: 'Request Body Models',
          description: 'Validate JSON bodies with Pydantic BaseModel classes and get editor completion.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/body/',
        },
        {
          id: 'query-validations',
          label: 'Query & Path Validations',
          description: 'Constrain parameters with Query/Path metadata: lengths, regex, numeric bounds.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/query-params-str-validations/',
        },
        {
          id: 'response-models',
          label: 'Response Models',
          description: 'Filter and document output with response_model and return type annotations.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/response-model/',
        },
        {
          id: 'dependency-injection',
          label: 'Dependency Injection',
          description: 'Hierarchical Depends() system for sharing logic, connections, and auth context.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/dependencies/',
          children: [
            {
              id: 'classes-as-dependencies',
              label: 'Classes as Dependencies',
              description: 'Use callable classes for parameterized, typed dependencies.',
              docsUrl: 'https://fastapi.tiangolo.com/tutorial/dependencies/classes-as-dependencies/',
            },
            {
              id: 'sub-dependencies',
              label: 'Sub-Dependencies',
              description: 'Compose dependencies that themselves depend on other dependencies.',
              docsUrl: 'https://fastapi.tiangolo.com/tutorial/dependencies/sub-dependencies/',
            },
            {
              id: 'global-dependencies',
              label: 'Global Dependencies',
              description: 'Apply dependencies to every route of the app or an APIRouter.',
              docsUrl: 'https://fastapi.tiangolo.com/tutorial/dependencies/global-dependencies/',
            },
            {
              id: 'dependencies-with-yield',
              label: 'Dependencies with yield',
              description: 'Setup/teardown dependencies (DB sessions) with context-manager semantics.',
              docsUrl: 'https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/',
            },
          ],
        },
        {
          id: 'background-tasks',
          label: 'BackgroundTasks',
          description: 'Run lightweight post-response work in-process without a separate worker.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/background-tasks/',
        },
        {
          id: 'middleware',
          label: 'Middleware',
          description: 'Wrap every request/response with ASGI middleware for timing, headers, etc.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/middleware/',
        },
        {
          id: 'cors',
          label: 'CORS Middleware',
          description: 'Allow browser origins with CORSMiddleware configuration.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/cors/',
        },
        {
          id: 'bigger-applications',
          label: 'APIRouter (Bigger Applications)',
          description: 'Split large apps into routers with shared prefixes, tags, and dependencies.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/bigger-applications/',
        },
        {
          id: 'handling-errors',
          label: 'Error Handling',
          description: 'HTTPException, custom exception handlers, and validation error overrides.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/handling-errors/',
        },
        {
          id: 'lifespan-events',
          label: 'Lifespan Events',
          description: 'Startup/shutdown logic (model loading, pools) via the lifespan context manager.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/events/',
        },
        {
          id: 'settings-pydantic',
          label: 'Settings (pydantic-settings)',
          description: 'Typed environment configuration with BaseSettings and .env support.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/settings/',
        },
        {
          id: 'openapi-metadata',
          label: 'OpenAPI Metadata & Docs UIs',
          description: 'Automatic OpenAPI 3.1 schema with Swagger UI and ReDoc, plus tags metadata.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/metadata/',
        },
        {
          id: 'generate-clients',
          label: 'Generate SDK Clients',
          description: 'Produce typed frontend/backend clients from the OpenAPI schema.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/generate-clients/',
        },
        {
          id: 'custom-response',
          label: 'Custom Response Classes',
          description: 'HTMLResponse, ORJSONResponse, FileResponse, StreamingResponse, and more.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/custom-response/',
        },
        {
          id: 'sub-applications',
          label: 'Sub-Applications (Mounts)',
          description: 'Mount independent FastAPI/ASGI apps under a path prefix.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/sub-applications/',
        },
        {
          id: 'request-files',
          label: 'File Uploads',
          description: 'Receive multipart uploads with UploadFile streaming semantics.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/request-files/',
        },
        {
          id: 'static-files',
          label: 'Static Files',
          description: 'Serve static assets with StaticFiles mounts.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/static-files/',
        },
        {
          id: 'graphql-integration',
          label: 'GraphQL (Strawberry)',
          description: 'Mount a GraphQL schema alongside REST routes using Strawberry or other libs.',
          docsUrl: 'https://fastapi.tiangolo.com/how-to/graphql/',
        },
      ],
    },
    {
      id: 'server-deployment',
      label: 'Server & Deployment',
      options: [
        {
          id: 'fastapi-cli',
          label: 'FastAPI CLI',
          description: 'fastapi dev / fastapi run commands for local dev and production serving.',
          docsUrl: 'https://fastapi.tiangolo.com/fastapi-cli/',
        },
        {
          id: 'uvicorn',
          label: 'Uvicorn',
          description: 'The lightning-fast ASGI server that runs FastAPI in dev and production.',
          docsUrl: 'https://www.uvicorn.org/',
        },
        {
          id: 'server-workers',
          label: 'Multiple Workers',
          description: 'Scale across CPU cores with uvicorn --workers or process managers.',
          docsUrl: 'https://fastapi.tiangolo.com/deployment/server-workers/',
        },
        {
          id: 'gunicorn',
          label: 'Gunicorn (process manager)',
          description: 'Battle-tested WSGI/process manager usable with uvicorn worker classes.',
          docsUrl: 'https://docs.gunicorn.org/en/stable/',
        },
        {
          id: 'docker',
          label: 'Docker Containers',
          description: 'Official container guidance: single-process images behind an orchestrator.',
          docsUrl: 'https://fastapi.tiangolo.com/deployment/docker/',
        },
        {
          id: 'https-tls',
          label: 'HTTPS & TLS Termination',
          description: 'How certificates, SNI, and TLS termination proxies fit around the app.',
          docsUrl: 'https://fastapi.tiangolo.com/deployment/https/',
        },
        {
          id: 'deployment-concepts',
          label: 'Deployment Concepts',
          description: 'Restarts, replication, memory, and previous-steps checklists for production.',
          docsUrl: 'https://fastapi.tiangolo.com/deployment/concepts/',
        },
        {
          id: 'cloud-providers',
          label: 'Cloud Deployment',
          description: 'Deploy on cloud providers or FastAPI Cloud with minimal configuration.',
          docsUrl: 'https://fastapi.tiangolo.com/deployment/cloud/',
        },
        {
          id: 'behind-a-proxy',
          label: 'Behind a Proxy',
          description: 'root_path handling when serving under path prefixes via reverse proxies.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/behind-a-proxy/',
        },
      ],
    },
    {
      id: 'persistence',
      label: 'Persistence & Databases',
      options: [
        {
          id: 'sqlmodel',
          label: 'SQLModel',
          description: 'Official companion ORM combining Pydantic models with SQLAlchemy tables.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/sql-databases/',
        },
        {
          id: 'sqlmodel-docs',
          label: 'SQLModel Documentation',
          description: 'Full SQLModel docs: relationships, indexes, and FastAPI integration patterns.',
          docsUrl: 'https://sqlmodel.tiangolo.com/',
        },
        {
          id: 'sqlalchemy-async',
          label: 'SQLAlchemy 2.0 AsyncEngine',
          description: 'Async ORM sessions and engines via sqlalchemy.ext.asyncio for non-blocking DB IO.',
          docsUrl: 'https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html',
        },
        {
          id: 'asyncpg',
          label: 'asyncpg',
          description: 'High-performance asyncio PostgreSQL driver used under SQLAlchemy async.',
          docsUrl: 'https://magicstack.github.io/asyncpg/current/',
        },
        {
          id: 'alembic',
          label: 'Alembic Migrations',
          description: 'Versioned schema migrations for SQLAlchemy/SQLModel metadata.',
          docsUrl: 'https://alembic.sqlalchemy.org/en/latest/',
        },
        {
          id: 'tortoise-orm',
          label: 'Tortoise ORM',
          description: 'Django-inspired asyncio ORM with a familiar queryset API.',
          docsUrl: 'https://tortoise.github.io/',
        },
        {
          id: 'motor',
          label: 'Motor (async MongoDB)',
          description: 'Coroutine-based MongoDB driver for asyncio applications.',
          docsUrl: 'https://motor.readthedocs.io/en/stable/',
        },
        {
          id: 'beanie',
          label: 'Beanie ODM',
          description: 'Async MongoDB object-document mapper built on Motor and Pydantic.',
          docsUrl: 'https://beanie-odm.dev/',
        },
        {
          id: 'testing-database',
          label: 'Testing a Database',
          description: 'Official recipe for overriding DB dependencies in tests.',
          docsUrl: 'https://fastapi.tiangolo.com/how-to/testing-database/',
        },
      ],
    },
    {
      id: 'auth-security',
      label: 'Auth & Security',
      options: [
        {
          id: 'security-first-steps',
          label: 'OAuth2 Security First Steps',
          description: 'Wire OAuth2PasswordBearer so docs UI gets an Authorize button.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/security/first-steps/',
        },
        {
          id: 'get-current-user',
          label: 'Current User Dependency',
          description: 'Resolve the authenticated user via a reusable Depends chain.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/security/get-current-user/',
        },
        {
          id: 'oauth2-password-flow',
          label: 'OAuth2 Password Flow',
          description: 'Token endpoint with form-encoded username/password per the OAuth2 spec.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/security/simple-oauth2/',
        },
        {
          id: 'oauth2-jwt',
          label: 'JWT Bearer Tokens',
          description: 'Sign and verify JWT access tokens with expiry and hashed passwords.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/',
        },
        {
          id: 'oauth2-scopes',
          label: 'OAuth2 Scopes',
          description: 'Fine-grained per-endpoint permissions with SecurityScopes.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/security/oauth2-scopes/',
        },
        {
          id: 'http-basic-auth',
          label: 'HTTP Basic Auth',
          description: 'Simple credential auth with timing-attack-safe comparison.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/security/http-basic-auth/',
        },
        {
          id: 'api-keys',
          label: 'API Keys (header/query/cookie)',
          description: 'APIKeyHeader/APIKeyQuery/APIKeyCookie security schemes from fastapi.security.',
          docsUrl: 'https://fastapi.tiangolo.com/reference/security/',
        },
      ],
    },
    {
      id: 'jobs-messaging',
      label: 'Background Jobs & Messaging',
      options: [
        {
          id: 'celery',
          label: 'Celery',
          description: 'Distributed task queue for heavy, retryable jobs beyond BackgroundTasks.',
          docsUrl: 'https://docs.celeryq.dev/en/stable/',
          children: [
            {
              id: 'celery-redis-broker',
              label: 'Redis Broker/Backend',
              description: 'Use Redis as the Celery message broker and result backend.',
              docsUrl: 'https://redis.io/docs/latest/',
            },
            {
              id: 'celery-rabbitmq-broker',
              label: 'RabbitMQ Broker',
              description: 'AMQP broker option for Celery with robust routing and acknowledgements.',
              docsUrl: 'https://www.rabbitmq.com/docs',
            },
          ],
        },
        {
          id: 'arq',
          label: 'ARQ',
          description: 'Asyncio-native Redis job queue from the Pydantic author; fits async FastAPI apps.',
          docsUrl: 'https://arq-docs.helpmanual.io/',
        },
        {
          id: 'dramatiq',
          label: 'Dramatiq',
          description: 'Simple, reliable task processing over RabbitMQ or Redis with sane defaults.',
          docsUrl: 'https://dramatiq.io/',
        },
      ],
    },
    {
      id: 'realtime-streaming',
      label: 'WebSockets & Streaming',
      options: [
        {
          id: 'websockets',
          label: 'WebSockets',
          description: 'Bidirectional realtime endpoints with @app.websocket and dependencies.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/websockets/',
        },
        {
          id: 'server-sent-events',
          label: 'Server-Sent Events',
          description: 'One-way event streams over HTTP for live updates and LLM token streaming.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/server-sent-events/',
        },
        {
          id: 'stream-json-lines',
          label: 'Streaming JSON Lines',
          description: 'Stream newline-delimited JSON responses for incremental results.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/stream-json-lines/',
        },
        {
          id: 'stream-data',
          label: 'StreamingResponse',
          description: 'Stream large or generated payloads without buffering in memory.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/stream-data/',
        },
        {
          id: 'testing-websockets',
          label: 'Testing WebSockets',
          description: 'Exercise websocket endpoints with TestClient context managers.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/testing-websockets/',
        },
      ],
    },
    {
      id: 'observability',
      label: 'Observability',
      options: [
        {
          id: 'prometheus-instrumentator',
          label: 'prometheus-fastapi-instrumentator',
          description: 'Expose /metrics with request count, latency, and size Prometheus metrics.',
          docsUrl: 'https://github.com/trallnag/prometheus-fastapi-instrumentator',
        },
        {
          id: 'otel-fastapi',
          label: 'OpenTelemetry FastAPI Instrumentation',
          description: 'Auto-instrument request traces via opentelemetry-instrumentation-fastapi.',
          docsUrl: 'https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/fastapi/fastapi.html',
        },
        {
          id: 'otel-python',
          label: 'OpenTelemetry Python SDK',
          description: 'Traces, metrics, and logs exported to any OTLP-compatible backend.',
          docsUrl: 'https://opentelemetry.io/docs/languages/python/',
        },
        {
          id: 'sentry-fastapi',
          label: 'Sentry FastAPI Integration',
          description: 'Error monitoring and performance tracing with the official sentry-sdk integration.',
          docsUrl: 'https://docs.sentry.io/platforms/python/integrations/fastapi/',
        },
      ],
    },
    {
      id: 'testing',
      label: 'Testing',
      options: [
        {
          id: 'testclient',
          label: 'TestClient',
          description: 'Synchronous httpx-based client for testing endpoints without a server.',
          docsUrl: 'https://fastapi.tiangolo.com/tutorial/testing/',
        },
        {
          id: 'async-tests',
          label: 'Async Tests',
          description: 'Test with httpx.AsyncClient and anyio for async DB calls inside tests.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/async-tests/',
        },
        {
          id: 'testing-dependencies',
          label: 'Dependency Overrides',
          description: 'Swap real dependencies for fakes with app.dependency_overrides.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/testing-dependencies/',
        },
        {
          id: 'testing-events',
          label: 'Testing Lifespan Events',
          description: 'Ensure startup/shutdown handlers run in tests via the client context manager.',
          docsUrl: 'https://fastapi.tiangolo.com/advanced/testing-events/',
        },
        {
          id: 'pytest',
          label: 'pytest',
          description: 'The standard Python test runner used throughout FastAPI documentation.',
          docsUrl: 'https://docs.pytest.org/en/stable/',
        },
        {
          id: 'httpx',
          label: 'HTTPX',
          description: 'Sync/async HTTP client underlying TestClient; also for outbound service calls.',
          docsUrl: 'https://www.python-httpx.org/',
        },
      ],
    },
    {
      id: 'ai-llm',
      label: 'AI & LLM Integration',
      options: [
        {
          id: 'langchain',
          label: 'LangChain',
          description: 'Framework for LLM apps: chains, agents, tool calling, and RAG pipelines.',
          docsUrl: 'https://docs.langchain.com/oss/python/langchain/overview',
        },
        {
          id: 'llamaindex',
          label: 'LlamaIndex',
          description: 'Data framework for indexing and querying structured/unstructured data with LLMs.',
          docsUrl: 'https://developers.llamaindex.ai/python/framework/',
        },
        {
          id: 'onnx-runtime',
          label: 'ONNX Runtime',
          description: 'Cross-platform accelerator for serving exported ML models with low latency.',
          docsUrl: 'https://onnxruntime.ai/docs/',
        },
        {
          id: 'pytorch',
          label: 'PyTorch',
          description: 'Deep learning framework for in-process model inference inside endpoints.',
          docsUrl: 'https://docs.pytorch.org/docs/stable/index.html',
        },
        {
          id: 'torchserve',
          label: 'TorchServe',
          description: 'PyTorch model serving with management/inference APIs; now in limited maintenance.',
          docsUrl: 'https://docs.pytorch.org/serve/',
          status: 'maintenance',
          successor: 'vLLM',
        },
        {
          id: 'vllm',
          label: 'vLLM',
          description: 'High-throughput LLM inference engine with PagedAttention and OpenAI-style API.',
          docsUrl: 'https://docs.vllm.ai/',
        },
        {
          id: 'transformers',
          label: 'Hugging Face Transformers',
          description: 'Pretrained model pipelines for text, vision, and audio inference.',
          docsUrl: 'https://huggingface.co/docs/transformers/index',
        },
        {
          id: 'pgvector',
          label: 'pgvector',
          description: 'PostgreSQL extension adding vector types and similarity search for embeddings.',
          docsUrl: 'https://github.com/pgvector/pgvector',
        },
        {
          id: 'qdrant',
          label: 'Qdrant',
          description: 'High-performance vector database with a first-party async Python client.',
          docsUrl: 'https://qdrant.tech/documentation/',
        },
        {
          id: 'chroma',
          label: 'Chroma',
          description: 'Open-source embedding database for quick RAG prototypes and local dev.',
          docsUrl: 'https://docs.trychroma.com/',
        },
      ],
    },
  ],
};

-- Activepieces Database Migration (Current System + New Tables)\n\nCREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  claimedBy TEXT,
  started TEXT,
  completed TEXT,
  dependsOn TEXT,
  files TEXT,
  parentId TEXT,
  scenarios TEXT,
  stage TEXT,
  qaVerdict TEXT,
  docs TEXT,
  reviewNote TEXT,
  leaseExpiresAt TEXT,
  attempts INTEGER DEFAULT 0,
  nextRetryAt TEXT,
  lastError TEXT,
  model TEXT,
  summary TEXT,
  etcMinutes INTEGER,
  etcSetAt TEXT,
  stageTimings TEXT,
  projectId TEXT,
  control TEXT,
  mergeBounces INTEGER,
  rescueCount INTEGER,
  logPath TEXT,
  intent TEXT,
  ownerNote TEXT,
  ownerBounces INTEGER,
  lastOutcome TEXT,
  handoffFrom TEXT,
  hops INTEGER,
  consultLog TEXT,
  pendingConsult TEXT,
  consultAnswer TEXT,
  failureDetail TEXT,
  plan TEXT,
  journal TEXT
);\n\nCREATE TABLE board_settings (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);\n\nCREATE TABLE git_tokens (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  token TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'readonly',
  username TEXT,
  host TEXT NOT NULL DEFAULT 'github.com',
  createdAt TEXT NOT NULL,
  projectId TEXT
);\n\nCREATE TABLE git_token_assignments (
  agent TEXT PRIMARY KEY,
  tokenId TEXT NOT NULL,
  projectId TEXT
);\n\nCREATE TABLE github_apps (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  appId TEXT,
  slug TEXT,
  name TEXT,
  privateKey TEXT,
  clientId TEXT,
  clientSecret TEXT,
  webhookSecret TEXT,
  htmlUrl TEXT,
  installationId TEXT,
  account TEXT,
  state TEXT,
  createdAt TEXT NOT NULL
);\n\nCREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repoPath TEXT,
  emoji TEXT,
  createdAt TEXT NOT NULL,
  runConfig TEXT,
  branch TEXT,
  cloneUrl TEXT,
  maxConcurrency INTEGER,
  runConfigConfirmed INTEGER,
  previewVerifiedAt TEXT,
  readinessBypass INTEGER
);\n\nCREATE TABLE agents (
  role TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  model TEXT NOT NULL,
  worktreeMode TEXT NOT NULL,
  ord INTEGER NOT NULL DEFAULT 0,
  isSystem INTEGER NOT NULL DEFAULT 0,
  promptTemplate TEXT NOT NULL,
  mergePromptTemplate TEXT,
  rescuePromptTemplate TEXT,
  acceptPromptTemplate TEXT
);\n\nCREATE TABLE agent_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);\n\nCREATE TABLE memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taskId TEXT,
  role TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  at TEXT NOT NULL
);\n\nCREATE TABLE workers (
  id TEXT PRIMARY KEY,
  host TEXT,
  pid INTEGER,
  startedAt TEXT,
  lastBeatAt TEXT
);\n\nCREATE TABLE locks (
  name TEXT PRIMARY KEY,
  holder TEXT,
  expiresAt TEXT
);\n\nCREATE TABLE system_state (
  key TEXT PRIMARY KEY,
  value TEXT
);\n\nCREATE TABLE agent_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taskId TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  timestamp TEXT NOT NULL,
  projectId TEXT
);\n\nCREATE TABLE agent_db_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agentName TEXT NOT NULL,
  taskId TEXT,
  query TEXT,
  timestamp TEXT NOT NULL
);\n\nCREATE TABLE context_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId TEXT NOT NULL,
  path TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  addedBy TEXT,
  useCount INTEGER NOT NULL DEFAULT 0,
  addedAt TEXT NOT NULL,
  lastUsedAt TEXT NOT NULL
);\n\nCREATE TABLE context_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId TEXT NOT NULL,
  path TEXT,
  op TEXT NOT NULL,
  actor TEXT,
  taskId TEXT,
  tokens INTEGER,
  durationMs INTEGER,
  reason TEXT,
  ts TEXT NOT NULL
);\n\nCREATE INDEX idx_tasks_status ON tasks(status);\n\nCREATE INDEX idx_tasks_stage ON tasks(stage);\n\nCREATE INDEX idx_tasks_project ON tasks(projectId);\n\nCREATE INDEX idx_tasks_project_status ON tasks(projectId, status);\n\nCREATE INDEX idx_tasks_status_stage ON tasks(status, stage);\n\nCREATE INDEX idx_agent_logs_task ON agent_logs(taskId);\n\nCREATE INDEX idx_agent_logs_project ON agent_logs(projectId);\n\nCREATE INDEX idx_db_usage_agent ON agent_db_usage(agentName);\n\nCREATE INDEX idx_db_usage_task ON agent_db_usage(taskId);\n\nCREATE INDEX idx_memory_kind ON memory(kind);\n\nCREATE UNIQUE INDEX idx_ctx_files_proj_path ON context_files(projectId, path);\n\nCREATE INDEX idx_ctx_files_proj ON context_files(projectId);\n\nCREATE INDEX idx_ctx_ops_proj ON context_ops(projectId);\n\nCREATE TABLE activepieces_webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId TEXT,
  agentRole TEXT,
  webhookUrl TEXT NOT NULL,
  createdAt TEXT NOT NULL
);\n\nCREATE INDEX idx_activepieces_project ON activepieces_webhooks(projectId);\n\nCREATE INDEX idx_activepieces_agent ON activepieces_webhooks(agentRole);\n\n
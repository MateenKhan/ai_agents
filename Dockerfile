# AI-Agents — one-image dev/demo build. Boots all three processes (frontend :6951,
# db-server :6952, orchestrator) with `pnpm run agents`. The `claude` CLI is baked in;
# supply ANTHROPIC_API_KEY at run time. `git` ships in the base image (worktrees need it).
FROM node:22-bookworm

# pnpm + the Claude Code CLI (provides the `claude` binary the agent runner spawns).
RUN npm install -g pnpm @anthropic-ai/claude-code

WORKDIR /app

# Install deps first for layer caching.
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile

# App source.
COPY . .

# Bind to all interfaces INSIDE the container (compose publishes to host loopback only).
# Headless agents can't answer permission prompts, so skip them (same as .env.example default).
ENV HOST=0.0.0.0 \
    CLAUDE_FLAGS=--dangerously-skip-permissions \
    VITE_API_BASE=http://127.0.0.1:6952

EXPOSE 6951 6952
CMD ["pnpm", "run", "agents"]

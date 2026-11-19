FROM node:24-bookworm-slim

WORKDIR /opt/knowledge
COPY scripts/ ./scripts/
COPY servers/knowledge-mcp.mjs ./servers/knowledge-mcp.mjs

USER node
WORKDIR /workspace
ENTRYPOINT ["node", "--no-warnings", "/opt/knowledge/scripts/sqlite-knowledge.mjs"]
CMD ["status", "--root", "/workspace"]

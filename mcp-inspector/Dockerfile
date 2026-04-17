# Dockerfile for MCP Inspector UI
FROM node:20-alpine

WORKDIR /app

# Install Inspector globally
RUN npm install -g @modelcontextprotocol/inspector

EXPOSE 4000

CMD npx @modelcontextprotocol/inspector

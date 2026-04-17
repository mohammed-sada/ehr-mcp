# Dockerfile for MCP server
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* tsconfig.json ./
RUN npm install

# Copy source (including config and .env if provided at build time)
COPY . .

EXPOSE 3333

# Default command runs the streamable HTTP server
CMD ["npm", "run", "start"]

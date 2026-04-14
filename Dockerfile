FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY dist/ dist/
COPY .well-known/ .well-known/
COPY package.json ./

ENV MCP_HTTP_PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]

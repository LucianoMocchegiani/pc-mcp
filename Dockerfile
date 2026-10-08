FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src src
RUN npm run build

FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist dist

# La carpeta del host se monta en /workspace (ver docker-compose.yml).
ENV PC_MCP_ROOTS=/workspace \
    PC_MCP_HOST=0.0.0.0 \
    PC_MCP_PORT=3020

EXPOSE 3020

CMD ["node", "dist/index.js"]

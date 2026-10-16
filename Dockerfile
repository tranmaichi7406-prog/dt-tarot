FROM node:20-alpine AS builder

WORKDIR /app

# Cài đặt công cụ biên dịch cho native addons (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Runtime Stage
FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache tzdata
ENV TZ=Asia/Ho_Chi_Minh

COPY package*.json ./
RUN apk add --no-cache python3 make g++ \
    && npm ci --omit=dev \
    && apk del python3 make g++

COPY --from=builder /app/dist ./dist
COPY src/database/schema.sql ./dist/database/schema.sql

# Thư mục lưu trữ database và config
RUN mkdir -p /app/data /app/config

EXPOSE 3000

CMD ["node", "dist/server.js"]

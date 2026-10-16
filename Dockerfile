FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Runtime Stage
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache tzdata
ENV TZ=Asia/Ho_Chi_Minh

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Thư mục lưu trữ database và config
RUN mkdir -p /app/data /app/config

EXPOSE 3000

CMD ["node", "dist/server.js"]

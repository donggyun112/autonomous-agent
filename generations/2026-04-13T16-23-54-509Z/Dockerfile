FROM node:20-alpine

WORKDIR /app

# pnpm 설치
RUN npm install -g pnpm

# 소스 복사
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src/ ./src/
COPY data/ ./data/

# 의존성 설치
RUN pnpm install --frozen-lockfile

# TypeScript 빌드
RUN pnpm build 2>/dev/null || true

# 기본 명령
CMD ["node", "-e", "console.log('Forge shell ready.')"]

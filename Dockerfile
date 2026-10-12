# ── LmsAuto — Next.js + Playwright/Chromium (Render free, 512MB) ───────────
FROM node:22-bookworm-slim

# Playwright tải browser vào path cố định (dễ copy/đọc ở runtime).
ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    LMS_CHROMIUM_LOW_MEMORY=1

WORKDIR /app

# 1) Cài deps Node (gồm devDeps để build Next + Tailwind). KHÔNG đặt
#    NODE_ENV=production ở bước này, nếu không npm sẽ bỏ qua devDependencies.
COPY package.json package-lock.json ./
RUN npm ci

# 2) Cài Chromium + thư viện hệ thống cho Playwright (cần quyền root lúc build).
RUN npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# 3) Build ứng dụng Next.js
COPY . .
RUN npm run build

# 4) Runtime
ENV NODE_ENV=production \
    PORT=10000 \
    HOSTNAME=0.0.0.0
EXPOSE 10000
CMD ["npm", "start"]

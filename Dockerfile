FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=18787
ENV SQLITE_PATH=/data/cpa-cron-web.db
ENV ENABLE_CRON=true

RUN mkdir -p /data

EXPOSE 18787

CMD ["npm", "run", "docker:start"]

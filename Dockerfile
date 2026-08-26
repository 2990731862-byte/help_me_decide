FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=8787
ENV APPROVAL_DB_PATH=/data/approval.sqlite
ENV APPROVAL_LEGACY_DATA=/data/data.json

VOLUME ["/data"]
EXPOSE 8787

CMD ["npm", "start"]

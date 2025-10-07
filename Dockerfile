FROM node:24.9.0-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./

CMD ["node", "server.ts"]

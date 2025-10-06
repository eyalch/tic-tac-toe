FROM node:22.17.1-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./

CMD ["node", "--experimental-strip-types", "server.ts"]

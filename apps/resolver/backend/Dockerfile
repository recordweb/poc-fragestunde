FROM node:20-alpine

WORKDIR /app

COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/ .

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]

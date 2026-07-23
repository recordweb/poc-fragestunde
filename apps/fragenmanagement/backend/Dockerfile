FROM node:20-alpine
WORKDIR /app
COPY apps/fragenmanagement/backend/package.json ./
RUN npm install --omit=dev
COPY apps/fragenmanagement/backend/src ./src
EXPOSE 3000
CMD ["npm", "start"]
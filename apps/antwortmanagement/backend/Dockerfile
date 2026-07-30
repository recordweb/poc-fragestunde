FROM node:20-alpine
WORKDIR /app
COPY apps/antwortmanagement/backend/package.json ./
RUN npm install --omit=dev
COPY apps/antwortmanagement/backend/src ./src
EXPOSE 3000
CMD ["npm", "start"]

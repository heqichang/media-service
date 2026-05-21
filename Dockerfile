FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache \
    ffmpeg \
    tzdata \
    && rm -rf /var/cache/apk/*

ENV TZ=Asia/Shanghai

COPY package*.json ./

RUN npm install --legacy-peer-deps

COPY prisma ./prisma/

RUN npx prisma generate

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]

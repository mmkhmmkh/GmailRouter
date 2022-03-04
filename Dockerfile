FROM node:16
MAINTAINER "vbha.mmk@gmail.com"

WORKDIR /usr/src/gmail_router

RUN yarn global add pm2

COPY package*.json ./

RUN yarn

COPY . .

ENV NODE_ENV production

CMD ["pm2-runtime", "process.yml", "--env", "production"]

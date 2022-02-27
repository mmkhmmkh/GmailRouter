FROM node:16

WORKDIR /usr/src/gmail_router

COPY package*.json ./

RUN yarn

COPY . .

CMD ["node", "index.js"]

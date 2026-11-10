FROM node:22-alpine
WORKDIR /app
COPY server.mjs .
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]

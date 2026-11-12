FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
RUN mkdir -p /app/data /app/uploads && chown node:node /app/data /app/uploads
ENV NODE_ENV=production PORT=4180 HOST=0.0.0.0
USER node
EXPOSE 4180
CMD ["node", "server.mjs"]

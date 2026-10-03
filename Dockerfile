# DocuFlow API: serves the React UI and the upload/jobs API.
FROM node:20-alpine AS client-build
WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
COPY --from=client-build /build/client/dist ./server/public
# The API and worker images both run as the built-in node user (uid 1000) so they can share the data volume.
RUN rm -rf server/tests server/coverage server/data && mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node
ENV NODE_ENV=production PORT=3000 SERVICE_NAME=docuflow-api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]

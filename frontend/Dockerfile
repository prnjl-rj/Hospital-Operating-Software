# =============================================================================
# MULTI-STAGE DOCKERFILE FOR HOS REACT FRONTEND (NGINX PRODUCTION SERVER)
# =============================================================================
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.base.json tsconfig.json ./
COPY frontend ./frontend

RUN npm install --no-audit --no-fund && npm --workspace=@hos/frontend run build

FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --retries=5 CMD wget -qO- http://localhost:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]


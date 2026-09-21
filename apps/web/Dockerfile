# Painel do Conecta Notifica (Next.js).
# Contexto de build: a RAIZ do repositório.
FROM node:22-alpine

WORKDIR /app

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY apps/web/ ./

# NEXT_PUBLIC_* é embutido no build, não lido em tempo de execução.
# "/api" (relativo) porque painel e API respondem no mesmo domínio — assim
# não há domínio hardcoded na imagem nem CORS entre eles.
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start"]

# API e worker do Conecta Notifica — a mesma imagem serve aos dois serviços;
# o que muda é o comando (dist/main.js x dist/worker.js).
# Contexto de build: a RAIZ do repositório.
FROM node:22-alpine

WORKDIR /app

# Camada de dependências separada: só refaz quando o package-lock muda.
# O schema vem junto porque o postinstall roda `prisma generate`.
COPY apps/api/package.json apps/api/package-lock.json ./
COPY apps/api/prisma ./prisma
RUN npm ci --no-audit --no-fund

COPY apps/api/ ./
# prisma generate já roda no postinstall; aqui só falta compilar.
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# npm start = prisma migrate deploy && node dist/main.js. O migrate é
# idempotente; se o banco não estiver de pé o container reinicia e tenta de novo.
CMD ["npm", "start"]

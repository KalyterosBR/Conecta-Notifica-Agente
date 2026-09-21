#!/usr/bin/env bash
# Publica o Conecta Notifica na VPS. Roda no Mac, dentro do repo:
#
#   ./deploy/publicar.sh
#
# Envia o código, instala dependências, builda, aplica as migrations e
# reinicia os serviços. Na primeira vez chama sozinho o preparar-vps.sh.
set -euo pipefail

VPS="${VPS:-root@72.61.221.172}"
CHAVE="${CHAVE:-$HOME/.ssh/id_ed25519_conecta}"
DOMINIO="${DOMINIO:-notifica.conectapontoeacesso.com.br}"
RAIZ=/opt/conecta-notifica

cd "$(dirname "$0")/.."
SSH=(ssh -i "$CHAVE" -o StrictHostKeyChecking=accept-new "$VPS")

echo "==> enviando código para $VPS:$RAIZ"
"${SSH[@]}" "mkdir -p $RAIZ"
rsync -az --delete -e "ssh -i $CHAVE -o StrictHostKeyChecking=accept-new" \
  --exclude '.git' --exclude 'node_modules' --exclude '.next' --exclude 'dist' \
  --exclude '.devdb' --exclude '.env' --exclude '.DS_Store' \
  --exclude 'apps/agent/bin' --exclude 'apps/agent/dist' --exclude 'agent.zip' \
  --exclude 'tsconfig.tsbuildinfo' \
  apps deploy docker-compose.yml files assests "$VPS:$RAIZ/"

if ! "${SSH[@]}" "test -f $RAIZ/api.env"; then
  echo "==> primeira publicação: preparando a VPS"
  "${SSH[@]}" "DOMINIO=$DOMINIO bash $RAIZ/deploy/preparar-vps.sh"
fi

echo "==> build da API"
"${SSH[@]}" "cd $RAIZ/apps/api && npm ci --no-audit --no-fund && npx prisma generate && npm run build"

echo "==> migrations"
"${SSH[@]}" "cd $RAIZ/apps/api && set -a && . $RAIZ/api.env && set +a && npx prisma migrate deploy"

echo "==> build do painel"
"${SSH[@]}" "cd $RAIZ/apps/web && npm ci --no-audit --no-fund && NEXT_PUBLIC_API_URL=https://$DOMINIO/api npm run build"

echo "==> permissões e serviços"
"${SSH[@]}" "chown -R conecta:conecta $RAIZ && systemctl restart conecta-api conecta-worker conecta-web && sleep 3 && systemctl is-active conecta-api conecta-worker conecta-web"

echo "==> conferindo pela porta local (antes do TLS)"
"${SSH[@]}" "curl -sS -o /dev/null -w 'api  %{http_code}\n' localhost:3001/v1/painel/visao-geral; curl -sS -o /dev/null -w 'web  %{http_code}\n' localhost:3000/login"

echo
echo "Publicado. Painel: https://$DOMINIO"
echo "Agente (config.yaml): saas.base_url: https://$DOMINIO/api"

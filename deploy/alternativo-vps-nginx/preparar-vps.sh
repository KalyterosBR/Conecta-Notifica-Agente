#!/usr/bin/env bash
# Bootstrap da VPS (roda como root, uma vez; é idempotente — rodar de novo
# não quebra nada e não sobrescreve segredos já gerados).
#
#   bash /opt/conecta-notifica/deploy/preparar-vps.sh
#
# Não toca em nada que já exista na máquina: outros sites do nginx, outros
# bancos e outros serviços seguem intocados.
set -euo pipefail

DOMINIO="${DOMINIO:-notifica.conectapontoeacesso.com.br}"
RAIZ=/opt/conecta-notifica
ENVFILE="$RAIZ/api.env"

[ "$(id -u)" -eq 0 ] || { echo "rode como root"; exit 1; }
[ -d "$RAIZ/apps/api" ] || { echo "envie o código primeiro (deploy/publicar.sh)"; exit 1; }

echo "==> checando quem já ocupa as portas"
# Esta VPS já hospeda outras coisas. Se a 80/443 for de outro servidor
# (Caddy, Apache, OpenLiteSpeed...), instalar nginx aqui derruba o que está
# no ar — melhor parar e decidir com calma.
donos=$(ss -tlnp 2>/dev/null | awk '$4 ~ /:(80|443)$/ {print $NF}' \
        | grep -oE '"[^"]+"' | tr -d '"' | sort -u | grep -v '^$' || true)
if [ -n "$donos" ] && ! echo "$donos" | grep -qx nginx; then
  echo "ABORTADO: a porta 80/443 já é de: $(echo $donos | tr '\n' ' ')"
  echo "Instalar nginx derrubaria esse serviço. Publique atrás dele"
  echo "(proxy para 127.0.0.1:3000 e :3001) em vez de trocar o servidor."
  exit 1
fi
for porta in 3000 3001; do
  if ss -tln 2>/dev/null | awk '{print $4}' | grep -qE ":$porta$"; then
    echo "ABORTADO: a porta $porta já está em uso nesta VPS."
    echo "Ajuste PORT no api.env / o -p do conecta-web antes de seguir."
    exit 1
  fi
done

echo "==> pacotes"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg rsync nginx redis-server \
  postgresql postgresql-contrib certbot python3-certbot-nginx openssl

# Node 22 pelo NodeSource — a versão do apt do Ubuntu é velha demais.
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  echo "==> node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "    node $(node -v), npm $(npm -v)"

echo "==> usuário de serviço"
id -u conecta >/dev/null 2>&1 || useradd --system --home "$RAIZ" --shell /usr/sbin/nologin conecta

echo "==> postgres"
systemctl enable --now postgresql
SENHA_PG="$(grep -oP '(?<=conecta_app:)[^@]+' "$ENVFILE" 2>/dev/null || true)"
if [ -z "$SENHA_PG" ]; then SENHA_PG="$(openssl rand -hex 24)"; fi
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='conecta_app'" | grep -q 1 \
  || sudo -u postgres psql -qc "CREATE ROLE conecta_app LOGIN PASSWORD '$SENHA_PG'"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='conecta_notifica'" | grep -q 1 \
  || sudo -u postgres createdb -O conecta_app conecta_notifica

echo "==> redis (só localhost)"
systemctl enable --now redis-server

echo "==> api.env"
if [ -f "$ENVFILE" ]; then
  echo "    já existe, mantendo os segredos atuais"
else
  cat > "$ENVFILE" <<EOF
# Gerado por preparar-vps.sh em $(date -Is). Não versionar.
DATABASE_URL="postgresql://conecta_app:$SENHA_PG@127.0.0.1:5432/conecta_notifica"
REDIS_URL="redis://127.0.0.1:6379"
PORT=3001
JWT_SECRET="$(openssl rand -hex 32)"
CORS_ORIGIN="https://$DOMINIO"
EOF
fi
chown root:conecta "$ENVFILE"
chmod 640 "$ENVFILE"
chown -R conecta:conecta "$RAIZ"

echo "==> systemd"
cp "$RAIZ/deploy/systemd/"conecta-*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable conecta-api conecta-worker conecta-web >/dev/null

echo "==> nginx"
cp "$RAIZ/deploy/nginx/notifica.conf" /etc/nginx/sites-available/notifica.conf
ln -sf /etc/nginx/sites-available/notifica.conf /etc/nginx/sites-enabled/notifica.conf
nginx -t
systemctl reload nginx

echo "==> firewall"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null || true
fi

echo
echo "Pronto. Falta o certificado — só funciona com o DNS de $DOMINIO"
echo "já apontando para esta VPS:"
echo
echo "    certbot --nginx -d $DOMINIO --agree-tos -m conectapontoeacesso@gmail.com --redirect"
echo

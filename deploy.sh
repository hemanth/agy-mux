#!/bin/bash
set -e

PROJECT=${1:-hemanth-hm}
ZONE=${2:-us-central1-a}
MACHINE=${3:-e2-medium}
NAME="agy-cloud"

echo "Deploying agy-cloud to $PROJECT..."

# Create VM
gcloud compute instances create $NAME \
  --project=$PROJECT --zone=$ZONE \
  --machine-type=$MACHINE \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --tags=http-server

# Firewall
gcloud compute firewall-rules create allow-agy-cloud \
  --project=$PROJECT --direction=INGRESS --action=ALLOW \
  --rules=tcp:3000 --target-tags=http-server \
  --source-ranges=0.0.0.0/0 2>/dev/null || true

# Get IP
IP=$(gcloud compute instances describe $NAME --project=$PROJECT --zone=$ZONE --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

# SSH and setup
gcloud compute ssh $NAME --project=$PROJECT --zone=$ZONE --command="
  sudo apt-get update -y && sudo apt-get install -y unzip git curl
  curl -fsSL https://bun.sh/install | bash
  curl -fsSL https://antigravity.google/cli/install.sh | bash
  export PATH=\$HOME/.bun/bin:\$HOME/.local/bin:\$PATH
  cd /opt && sudo git clone https://github.com/hemanth/agy-cloud.git
  sudo chown -R \$(whoami) /opt/agy-cloud && cd /opt/agy-cloud
  TOKEN=\$(openssl rand -hex 32)
  echo AUTH_TOKEN=\$TOKEN > .env && echo PORT=3000 >> .env
  nohup bun run server/index.js > /tmp/agy-cloud.log 2>&1 &
  echo ''
  echo '========================================'
  echo 'agy-cloud deployed!'
  echo \"Server: http://$IP:3000\"
  echo \"Token:  \$TOKEN\"
  echo '========================================'
"

echo ""
echo "Configure CLI: agy-cloud config"
echo "  Server: http://$IP:3000"
echo "  Token: (see above)"

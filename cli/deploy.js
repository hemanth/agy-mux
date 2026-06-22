// agy-mux — GCE deployment manager

import { execSync, spawn } from 'child_process';
import { saveConfig } from './config.js';

const DEFAULTS = {
  project: 'hemanth-hm',
  zone: 'us-central1-a',
  machine: 'e2-medium',
  name: 'agy-remote',
};

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit', ...opts }).trim();
  } catch (e) {
    if (opts.ignoreError) return '';
    throw e;
  }
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

export async function cmdDeploy(subcommand, flags = {}) {
  const project = flags.project || DEFAULTS.project;
  const zone = flags.zone || DEFAULTS.zone;
  const machine = flags.machine || DEFAULTS.machine;
  const name = DEFAULTS.name;

  switch (subcommand) {
    case 'status':
      return deployStatus(name, project, zone);
    case 'teardown':
      return deployTeardown(name, project, zone);
    case 'logs':
      return deployLogs(name, project, zone);
    default:
      return deployCreate(name, project, zone, machine);
  }
}

async function deployCreate(name, project, zone, machine) {
  console.log(`\n  Deploying agy-mux to ${project}...\n`);

  // Check gcloud
  try {
    runCapture('gcloud --version');
  } catch {
    console.error('  Error: gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install');
    process.exit(1);
  }

  // Check if VM already exists
  try {
    const existing = runCapture(
      `gcloud compute instances describe ${name} --project=${project} --zone=${zone} --format='get(status)' 2>/dev/null`
    );
    if (existing) {
      console.log(`  VM "${name}" already exists (${existing}).`);
      console.log('  Run "agy-mux deploy teardown" first, or "agy-mux deploy status" to check.\n');
      process.exit(1);
    }
  } catch {
    // VM doesn't exist, good
  }

  // Create VM
  console.log('  [1/5] Creating VM...');
  run(`gcloud compute instances create ${name} \
    --project=${project} --zone=${zone} \
    --machine-type=${machine} \
    --image-family=debian-12 --image-project=debian-cloud \
    --boot-disk-size=30GB --tags=http-server`, { quiet: true });

  // Firewall
  console.log('  [2/5] Configuring firewall...');
  run(`gcloud compute firewall-rules create allow-${name} \
    --project=${project} --direction=INGRESS --action=ALLOW \
    --rules=tcp:3000 --target-tags=http-server \
    --source-ranges=0.0.0.0/0 2>/dev/null`, { ignoreError: true, quiet: true });

  // Get IP
  const ip = runCapture(
    `gcloud compute instances describe ${name} --project=${project} --zone=${zone} --format='get(networkInterfaces[0].accessConfigs[0].natIP)'`
  );
  console.log(`  [3/5] VM ready at ${ip}`);

  // Generate token
  const token = runCapture('openssl rand -hex 32');

  // Setup via startup script + reset (SSH is unreliable)
  console.log('  [4/5] Installing bun + agy-mux (VM will reboot)...');
  const startupScript = `#!/bin/bash
set -e
apt-get update -y && apt-get install -y unzip git curl
su - \$(logname || echo "root") -c '
  curl -fsSL https://bun.sh/install | bash
  export PATH=\$HOME/.bun/bin:\$PATH
  cd /opt
  git clone https://github.com/hemanth/agy-mux.git 2>/dev/null || (cd agy-mux && git pull)
  cd /opt/agy-mux
  echo "AUTH_TOKEN=${token}" > .env
  echo "PORT=3000" >> .env
  nohup bun run start > /tmp/agy-mux.log 2>&1 &
'`;

  run(`gcloud compute instances add-metadata ${name} \
    --project=${project} --zone=${zone} \
    --metadata=startup-script='${startupScript.replace(/'/g, "'\\''")}'`, { quiet: true });

  run(`gcloud compute instances reset ${name} --project=${project} --zone=${zone}`, { quiet: true });

  // Wait for server
  console.log('  [5/5] Waiting for server...');
  const serverUrl = `http://${ip}:3000`;
  let ready = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const res = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) { ready = true; break; }
    } catch {}
    process.stdout.write('.');
  }
  console.log('');

  if (!ready) {
    console.log(`  Server not ready yet. Check manually: curl ${serverUrl}/health`);
    console.log(`  Token: ${token}\n`);
    process.exit(1);
  }

  // Auto-configure CLI
  saveConfig({ server: serverUrl, token });

  console.log(`
  ✅ agy-mux deployed!

  Server:  ${serverUrl}
  Token:   ${token}
  VM:      ${name} (${project}/${zone})

  Config auto-saved. You're ready:

    agy-mux start my-feature
`);
}

async function deployStatus(name, project, zone) {
  try {
    const status = runCapture(
      `gcloud compute instances describe ${name} --project=${project} --zone=${zone} --format='get(status)'`
    );
    const ip = runCapture(
      `gcloud compute instances describe ${name} --project=${project} --zone=${zone} --format='get(networkInterfaces[0].accessConfigs[0].natIP)'`
    );
    console.log(`\n  VM:      ${name} (${status})`);
    console.log(`  IP:      ${ip}`);

    try {
      const res = await fetch(`http://${ip}:3000/health`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      console.log(`  Server:  ✅ running (${data.sessions} sessions)`);
    } catch {
      console.log('  Server:  ❌ not responding');
    }
    console.log('');
  } catch {
    console.log('\n  VM not found.\n');
  }
}

function deployTeardown(name, project, zone) {
  console.log(`\n  Deleting VM "${name}"...`);
  run(`gcloud compute instances delete ${name} --project=${project} --zone=${zone} --quiet`, { quiet: true });
  console.log('  ✅ VM deleted.\n');
}

function deployLogs(name, project, zone) {
  console.log(`\n  Fetching server logs...\n`);
  run(`gcloud compute ssh ${name} --project=${project} --zone=${zone} --command="cat /tmp/agy-mux.log 2>/dev/null | tail -50"`);
}

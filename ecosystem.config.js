module.exports = {
  apps: [{
    name: 'linkedin-daemon',
    script: '/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
    args: '--remote-debugging-port=9222 --user-data-dir=/root/.openclaw/workspace-prospection/linkedin-automation/chrome-profile --no-first-run --no-default-browser-check --no-sandbox --disable-gpu --headless=new --lang=fr-FR --window-size=1920,1080 --proxy-server=socks5://127.0.0.1:1080',
    interpreter: 'none',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    // Pas de cron_restart fixe — le morning planner (8h) choisit 2 heures aléatoires chaque jour
  }, {
    name: 'socks5-tunnel',
    script: 'bash',
    args: '-c "while true; do sshpass -p jowho2-rosvub-zyxVaq ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -N -D 1080 pi@100.103.38.25; echo Tunnel dropped, reconnecting...; sleep 5; done"',
    interpreter: 'none',
    autorestart: true,
    max_restarts: 999,
    restart_delay: 3000,
  }]
};

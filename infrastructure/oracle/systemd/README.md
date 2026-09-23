# Native systemd deployment

These units run the API, publish worker, and analytics scheduler without
Docker. The production release directory is `/opt/social-promotion/current`,
the secret environment file is `/etc/social-promotion/backend.env`, and media
is persisted under `/var/lib/social-promotion/uploads`.

Create a dedicated unprivileged account and directories once:

```bash
sudo useradd --system --home /var/lib/social-promotion --shell /sbin/nologin social-promotion
sudo install -d -o social-promotion -g social-promotion /opt/social-promotion/releases
sudo install -d -o root -g social-promotion -m 0750 /etc/social-promotion
sudo install -d -o social-promotion -g social-promotion /var/lib/social-promotion/uploads
```

Build each release in a new `/opt/social-promotion/releases/<release-id>`
directory with Node.js 20 or newer. Run `npm ci`, `npm run build`, and all
required checks before switching the `current` symlink. Do not store provider
secrets in the release directory.

Install the unit files under `/etc/systemd/system`, then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable social-promotion-api social-promotion-worker social-promotion-scheduler
```

Use the quiesce, migration, restart, and verification order in
[`docs/deployment.md`](../../../docs/deployment.md). Do not restart all three
processes blindly during a state-machine migration.

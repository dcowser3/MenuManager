# AWS Deployment (Cost-Optimized)

This repo is structured as a multi-service monorepo. The cheapest AWS path is a single Lightsail instance running Docker Compose with a persistent volume for `/app/tmp`.

## Option A: Lightsail + Docker Compose (Lowest Cost)

Lightsail is the lowest-friction, lowest-cost path for this repo shape. It is an EC2 VM with a simplified console and predictable monthly pricing.

### 1. Provision Lightsail

- Create an instance (Linux/Ubuntu).
- Start small (2 GB is a good baseline for multiple Node services).
- Add a static IP.
- Networking:
  - `22` (SSH)
  - `3005` (Dashboard) or `80/443` if fronted by Nginx

### 2. Install Docker

```
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo systemctl enable docker
sudo usermod -a -G docker $USER
```

Log out/in after adding your user to the docker group.

### 3. Deploy the Repo

```
git clone <repo>
cd MenuManager
cp .env.example .env
```

Fill out `.env` with:
- `OPENAI_API_KEY`
- `INTERNAL_API_TOKEN` (same value in every service container)
- `CLICKUP_API_TOKEN` + related ClickUp vars
- `SUPABASE_*` (if using Supabase)
- Set service URLs for container networking:
  - `DB_SERVICE_URL=http://db:3004`
  - `AI_REVIEW_URL=http://ai-review:3002`
  - `DIFFER_SERVICE_URL=http://differ:3006`
  - `CLICKUP_SERVICE_URL=http://clickup-integration:3007`
  - `DASHBOARD_URL=https://<your-public-url>`

### 4. Run with Docker Compose

```
docker compose up -d --build
```

Note: On some Ubuntu images, the command is `docker-compose` (with a dash).

For routine deploys, prefer the combined rebuild/recreate command:

```
docker compose up -d --build --remove-orphans
```

This replaces the separate `docker compose build && docker compose up -d` flow while also removing containers for services that were deleted or renamed in `docker-compose.yml`.

Logs:
```
docker compose logs -f dashboard
```

### 5. Persistence

The compose file mounts named volumes for:
- `/app/tmp` (DB JSON, AI drafts, learning data, document storage)
- `/app/logs`

If you want a host-path mount instead of named volumes:
```
volumes:
  - /opt/menumanager/tmp:/app/tmp
  - /opt/menumanager/logs:/app/logs
```

## Automated Lightsail Deploys from GitHub

The repository includes `.github/workflows/deploy-lightsail.yml`, which runs on pushes to `main` and can also be started manually from GitHub Actions. The workflow connects to the Lightsail instance over SSH, syncs the server checkout to the pushed commit, and runs:

```
docker compose up -d --build --remove-orphans
```

### Server assumptions

- The app is already cloned on the Lightsail instance.
- The server checkout can already fetch from GitHub with `git pull` or `git fetch`.
- The deploy user can run Docker either directly or with passwordless `sudo docker`.
- Production secrets stay in the server-side `.env`; they are not stored in GitHub Actions.
- Do not edit tracked repo files directly on the server. The workflow uses `git reset --hard origin/main` so the running checkout exactly matches the pushed commit.

### Create a deploy SSH key

Create a dedicated key for GitHub Actions, then add the public key to the Lightsail user's `~/.ssh/authorized_keys`.

```
ssh-keygen -t ed25519 -C "github-actions-menumanager-lightsail" -f ./menumanager_lightsail_deploy
ssh-copy-id -i ./menumanager_lightsail_deploy.pub ubuntu@<lightsail-static-ip>
```

If `ssh-copy-id` is not available, connect to Lightsail and append the `.pub` file contents to `~/.ssh/authorized_keys` for the deploy user.

### Add GitHub repository secrets

In GitHub, open the repo settings and go to **Secrets and variables** -> **Actions**. Add:

| Secret | Example | Notes |
|--------|---------|-------|
| `LIGHTSAIL_HOST` | `203.0.113.10` | Use the Lightsail static IP or DNS name. |
| `LIGHTSAIL_USER` | `ubuntu` | Optional in the workflow, but set it explicitly if your image uses `bitnami`, `ec2-user`, or another user. |
| `LIGHTSAIL_SSH_KEY` | contents of `menumanager_lightsail_deploy` | Paste the private key, including the BEGIN/END lines. |
| `LIGHTSAIL_SSH_PORT` | `22` | Optional unless SSH uses a custom port. |
| `LIGHTSAIL_DEPLOY_PATH` | `/home/ubuntu/MenuManager` | Optional if your repo lives at this default path. |
| `LIGHTSAIL_KNOWN_HOSTS` | output of `ssh-keyscan -p 22 <host>` | Optional but recommended to pin the server host key. |

Generate the optional known-hosts value with:

```
ssh-keyscan -p 22 <lightsail-static-ip>
```

After the secrets are saved, pushing to `main` deploys automatically. To test without a new commit, open **Actions** -> **Deploy to Lightsail** -> **Run workflow**.

## Option B: EC2 + Docker Compose (More Control)

### 1. Provision EC2

- Instance type: `t3.small` or `t3.medium` (CPU/RAM depends on traffic)
- Storage: 30-50 GB gp3 (or larger if storing many DOCX assets)
- Security group inbound:
  - `22` (SSH)
  - `3005` (Dashboard) or `80/443` if you front it with Nginx/ALB

### 2. Install Docker

```
sudo yum update -y
sudo amazon-linux-extras install docker -y
sudo service docker start
sudo usermod -a -G docker ec2-user
```

Log out/in after adding your user to the docker group.

### 3. Deploy the Repo

```
git clone <repo>
cd MenuManager
cp .env.example .env
```

Fill out `.env` with:
- `OPENAI_API_KEY`
- `INTERNAL_API_TOKEN` (same value in every service container)
- `CLICKUP_API_TOKEN` + related ClickUp vars
- `SUPABASE_*` (if using Supabase)
- Set service URLs for container networking:
  - `DB_SERVICE_URL=http://db:3004`
  - `AI_REVIEW_URL=http://ai-review:3002`
  - `DIFFER_SERVICE_URL=http://differ:3006`
  - `CLICKUP_SERVICE_URL=http://clickup-integration:3007`
  - `DASHBOARD_URL=https://<your-public-url>`

### 4. Run with Docker Compose

```
docker compose up -d --build
```

Logs:
```
docker compose logs -f dashboard
```

### 5. Persistence

The compose file mounts named volumes for:
- `/app/tmp` (DB JSON, AI drafts, learning data, document storage)
- `/app/logs`

If you want a host-path mount instead of named volumes:
```
volumes:
  - /opt/menumanager/tmp:/app/tmp
  - /opt/menumanager/logs:/app/logs
```

## Option C: ECS (More Robust, Higher Effort)

Recommended if you want managed scaling or a multi-AZ setup.

### Minimal ECS setup guidance

1. Build and push images to ECR (one per service).
2. Create a task definition with six containers:
   - `db`, `parser`, `ai-review`, `dashboard`, `differ`, `clickup-integration`
3. Configure environment variables for inter-service URLs:
   - Use service discovery or internal ALB DNS names
4. Attach a shared EFS volume for `/app/tmp` if you need persistence.
5. Route `dashboard` to a public ALB on `80/443`.

## Notes

- If you don’t use Supabase, the DB service stores data locally under `/app/tmp/db`.
- `DOCUMENT_STORAGE_ROOT` should point into `/app/tmp` or another persistent path.
- The dashboard uses `DASHBOARD_URL` for email links; set this to your public domain.
- Docker builds run the workspace TypeScript compiles; ensure your repo is up to date before building.
- Docker builds also create the `docx-redliner` Python virtualenv inside the images; builds need outbound access for pip to download dependencies.

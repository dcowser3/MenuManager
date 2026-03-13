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

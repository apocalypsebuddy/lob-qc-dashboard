# Seeds Dashboard

A Self-Serve Seeds Dashboard built with AdonisJS 6 for managing Lob postcard campaigns and proof tracking.

## Features

- User authentication (register/login)
- Seed management (create rules for postcard campaigns)
- Lob API integration for postcard creation
- Proof tracking with status updates
- Live proof photo uploads
- Quality rating and review system

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

3. Generate an app key:

```bash
node ace generate:key
```

4. Set up your PostgreSQL database and update `.env` with database credentials.

5. Run migrations:

```bash
node ace migration:run
```

6. Start the development server:

```bash
npm run dev
```

## Configuration

### Environment Variables

- `DB_HOST` - PostgreSQL host
- `DB_PORT` - PostgreSQL port
- `DB_USER` - PostgreSQL user
- `DB_PASSWORD` - PostgreSQL password
- `DB_DATABASE` - Database name
- `APP_KEY` - Application encryption key (generate with `node ace generate:key`)

### Lob API

1. Sign up for a Lob account and get your API key
2. Add your Lob API key in Settings after logging in
3. Configure your "from" address in `app/services/lob_client.ts` (currently hardcoded for PoC)

### Live Proof Service

The live proof ingestion service endpoint is configured in `app/services/live_proof_service.ts`. The endpoint is:

- POST: `https://94f0nmul0k.execute-api.us-west-2.amazonaws.com/proofs-production/scan-events`
- GET: `https://94f0nmul0k.execute-api.us-west-2.amazonaws.com/proofs-production/scan-events/:resource_id`

## Usage

1. Register a new account
2. Add your Lob API key in Settings
3. Create a Seed with:
   - Front and back template IDs
   - To address information
4. Run the seed to create a postcard via Lob API
5. Track proof status (created → mailed → delivered → awaiting_review → completed)
6. Upload live proof photos from your phone
7. Rate quality and add notes

## Webhooks

Lob webhooks are received at `/webhooks/lob` and update proof status automatically.

## Docker

### Building the Docker Image

The application includes PostgreSQL in the same container for easy deployment:

```bash
docker build -t hackathon-pudding .
```

### Running with Docker

```bash
docker run -p 3333:3333 \
  -e DB_PASSWORD=your_password \
  -e APP_KEY=your_app_key \
  -e DB_DATABASE=hackathon_pudding \
  hackathon-pudding
```

The container will:
1. Start PostgreSQL automatically
2. Create the database if it doesn't exist
3. Run migrations
4. Start the AdonisJS server

### Environment Variables for Docker

Required environment variables:
- `DB_PASSWORD` - PostgreSQL password (default: `postgres`)
- `APP_KEY` - AdonisJS encryption key (required)
- `DB_DATABASE` - Database name (default: `hackathon_pudding`)
- `DB_USER` - PostgreSQL user (default: `postgres`)
- `DB_HOST` - Database host (default: `localhost`)
- `DB_PORT` - Database port (default: `5432`)
- `PORT` - Application port (default: `3333`)
- `HOST` - Application host (default: `0.0.0.0`)
- `NODE_ENV` - Environment (default: `production`)

Optional:
- `LOG_LEVEL` - Logging level (default: `info`)
- `SESSION_DRIVER` - Session driver (default: `cookie`)
- `SCAN_EVENTS_API_URL` - Scan events API URL

## AWS Deployment

### Prerequisites

1. AWS Account with ECR and App Runner access
2. GitHub repository with Actions enabled
3. AWS credentials configured as GitHub Secrets:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_REGION` (default: `us-west-2`)

### ECR Repository Setup

1. Create an ECR repository named `hackathon-pudding`:
   ```bash
   aws ecr create-repository --repository-name hackathon-pudding --region us-west-2
   ```

2. Update the `ECR_REPOSITORY` and `AWS_REGION` in `.github/workflows/deploy.yml` if needed

### App Runner Service Setup

1. Create an App Runner service in the AWS Console:
   - Source: Amazon ECR
   - Image: Select your ECR repository and `latest` tag
   - Port: `3333`
   - Auto-deploy: Enabled (automatically deploys when new images are pushed)

2. Configure environment variables in App Runner:
   - `NODE_ENV=production`
   - `HOST=0.0.0.0`
   - `PORT=3333`
   - `DB_HOST=localhost`
   - `DB_PORT=5432`
   - `DB_USER=postgres`
   - `DB_PASSWORD=<secure-password>`
   - `DB_DATABASE=hackathon_pudding`
   - `APP_KEY=<generate-with-node-ace-generate-key>`
   - `LOG_LEVEL=info`
   - `SESSION_DRIVER=cookie`

3. Configure health check:
   - Path: `/` (or your health check endpoint)
   - Protocol: HTTP
   - Interval: 10 seconds
   - Timeout: 5 seconds

### CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/deploy.yml`) automatically:
- Builds the Docker image on push to `main` branch
- Tags the image with the commit SHA and `latest`
- Pushes to ECR
- App Runner automatically deploys the new image (if auto-deploy is enabled)

To trigger a deployment, simply push to the `main` branch:
```bash
git push origin main
```

## Development

- Run migrations: `node ace migration:run`
- Rollback migrations: `node ace migration:rollback`
- Create migration: `node ace make:migration <name>`
- Create controller: `node ace make:controller <name>`
- Create model: `node ace make:model <name>`

## Project Structure

```
app/
  controllers/     # HTTP request handlers
  models/          # Database models
  services/        # Business logic services
  validators/      # Form validation
  middleware/      # Request middleware
database/
  migrations/      # Database schema migrations
resources/
  views/           # Edge templates
start/
  routes.ts        # Route definitions
  kernel.ts        # Middleware configuration
```

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

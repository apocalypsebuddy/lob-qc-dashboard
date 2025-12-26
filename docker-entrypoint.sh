#!/bin/bash
# Enable verbose output and ensure errors are visible
set -x
# Don't exit on error - we'll handle errors explicitly
set +e

# Redirect all output to stdout/stderr so App Runner can see it
exec 1>&1
exec 2>&2

echo "=========================================="
echo "Starting docker-entrypoint.sh"
echo "=========================================="

# Function to wait for PostgreSQL to be ready
wait_for_postgres() {
    echo "Waiting for PostgreSQL to be ready..."
    local max_attempts=60
    local attempt=0
    until sudo -u postgres psql -c '\q' 2>/dev/null; do
        attempt=$((attempt + 1))
        if [ $attempt -ge $max_attempts ]; then
            echo "PostgreSQL failed to start after $max_attempts attempts"
            echo "Checking PostgreSQL status..."
            sudo -u postgres psql -c '\q' 2>&1 || true
            exit 1
        fi
        echo "PostgreSQL is unavailable - sleeping (attempt $attempt/$max_attempts)"
        sleep 1
    done
    echo "PostgreSQL is up and running"
}

# Find PostgreSQL version and binaries
PG_VERSION=$(ls /usr/lib/postgresql/ | head -1)
PG_BIN="/usr/lib/postgresql/$PG_VERSION/bin"
PG_DATA="/var/lib/postgresql/data"

# Initialize PostgreSQL if data directory is empty
if [ ! -s "$PG_DATA/PG_VERSION" ]; then
    echo "Initializing PostgreSQL data directory..."
    sudo -u postgres "$PG_BIN/initdb" -D "$PG_DATA" --auth-local=trust --auth-host=scram-sha-256
    echo "host all all 0.0.0.0/0 scram-sha-256" >> "$PG_DATA/pg_hba.conf"
    echo "listen_addresses = '*'" >> "$PG_DATA/postgresql.conf"
fi

# Start PostgreSQL in the background
echo "Starting PostgreSQL..."
echo "PG_BIN: $PG_BIN"
echo "PG_DATA: $PG_DATA"
ls -la "$PG_BIN/postgres" || echo "ERROR: postgres binary not found at $PG_BIN/postgres"

# Start PostgreSQL and capture both stdout and stderr
sudo -u postgres "$PG_BIN/postgres" -D "$PG_DATA" >> /var/log/postgresql.log 2>&1 &
PG_PID=$!
echo "PostgreSQL started with PID: $PG_PID"
echo "Waiting a moment for PostgreSQL to initialize..."
sleep 3

# Check if PostgreSQL process is still running
if ! kill -0 $PG_PID 2>/dev/null; then
    echo "ERROR: PostgreSQL process died immediately!"
    echo "PostgreSQL log:"
    cat /var/log/postgresql.log || true
    exit 1
fi

# Wait for PostgreSQL to be ready
wait_for_postgres
WAIT_EXIT=$?

if [ $WAIT_EXIT -ne 0 ]; then
    echo "ERROR: PostgreSQL failed to start!"
    echo "PostgreSQL log:"
    cat /var/log/postgresql.log || true
    echo "Checking if process is still running:"
    ps aux | grep postgres || true
    exit 1
fi

# Set default values for database environment variables
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-postgres}
DB_DATABASE=${DB_DATABASE:-lob_qc_dashboard}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}

# Create database if it doesn't exist
echo "Creating database if it doesn't exist..."
sudo -u postgres psql -c "CREATE DATABASE $DB_DATABASE;" || echo "Database already exists"

# Set PostgreSQL password if provided
if [ -n "$DB_PASSWORD" ]; then
    echo "Setting PostgreSQL password..."
    sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" || true
fi

# Export environment variables for the app
export DB_HOST=$DB_HOST
export DB_PORT=$DB_PORT
export DB_USER=$DB_USER
export DB_PASSWORD=$DB_PASSWORD
export DB_DATABASE=$DB_DATABASE

# Run migrations
echo "Running database migrations..."
cd /app || {
    echo "ERROR: Failed to change to /app directory"
    exit 1
}

echo "Current directory: $(pwd)"
echo "Checking if ace.js exists:"
ls -la ace.js || ls -la build/ace.js || echo "ace.js not found in current location"

node ace migration:run
MIGRATION_EXIT=$?
if [ $MIGRATION_EXIT -ne 0 ]; then
    echo "WARNING: Migrations exited with code $MIGRATION_EXIT"
    echo "This might be okay if migrations were already run, continuing..."
fi

# Ensure PostgreSQL stays running (in case of issues)
trap "kill $PG_PID 2>/dev/null || true" EXIT

# Start the application
echo "=========================================="
echo "Starting AdonisJS application..."
echo "PostgreSQL PID: $PG_PID"
echo "Command: $@"
echo "Working directory: $(pwd)"
echo "Environment variables:"
echo "  DB_HOST=$DB_HOST"
echo "  DB_PORT=$DB_PORT"
echo "  DB_USER=$DB_USER"
echo "  DB_DATABASE=$DB_DATABASE"
echo "  NODE_ENV=${NODE_ENV:-not set}"
echo "  PORT=${PORT:-not set}"
echo "=========================================="

# Verify PostgreSQL is still running before starting app
if ! kill -0 $PG_PID 2>/dev/null; then
    echo "ERROR: PostgreSQL process died before starting app!"
    exit 1
fi

# Check if the command exists
if [ "$1" = "npm" ] && [ "$2" = "start" ]; then
    echo "Checking npm and package.json..."
    which npm || echo "ERROR: npm not found"
    ls -la package.json || echo "ERROR: package.json not found"
    echo "Running: npm start"
fi

# Start the application (this replaces the shell process)
# Use exec to replace shell, but ensure we can see errors
exec "$@" 2>&1


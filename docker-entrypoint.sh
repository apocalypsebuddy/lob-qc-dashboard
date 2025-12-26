#!/bin/bash
# Don't exit on error - we'll handle errors explicitly
set +e

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
sudo -u postgres "$PG_BIN/postgres" -D "$PG_DATA" > /var/log/postgresql.log 2>&1 &
PG_PID=$!
echo "PostgreSQL started with PID: $PG_PID"

# Give PostgreSQL a moment to start
sleep 2

# Wait for PostgreSQL to be ready
wait_for_postgres

if [ $? -ne 0 ]; then
    echo "ERROR: PostgreSQL failed to start!"
    echo "PostgreSQL log:"
    tail -50 /var/log/postgresql.log || true
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
echo "Starting AdonisJS application..."
echo "PostgreSQL PID: $PG_PID"
exec "$@"


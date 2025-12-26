#!/bin/bash
set -e

# Function to wait for PostgreSQL to be ready
wait_for_postgres() {
    echo "Waiting for PostgreSQL to be ready..."
    local max_attempts=30
    local attempt=0
    until sudo -u postgres psql -c '\q' 2>/dev/null; do
        attempt=$((attempt + 1))
        if [ $attempt -ge $max_attempts ]; then
            echo "PostgreSQL failed to start after $max_attempts attempts"
            exit 1
        fi
        echo "PostgreSQL is unavailable - sleeping (attempt $attempt/$max_attempts)"
        sleep 1
    done
    echo "PostgreSQL is up and running"
}

# Initialize PostgreSQL if data directory is empty
if [ ! -s /var/lib/postgresql/data/PG_VERSION ]; then
    echo "Initializing PostgreSQL data directory..."
    sudo -u postgres /usr/lib/postgresql/*/bin/initdb -D /var/lib/postgresql/data
fi

# Start PostgreSQL service
echo "Starting PostgreSQL..."
service postgresql start

# Wait for PostgreSQL to be ready
wait_for_postgres

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
node ace migration:run || echo "Migrations completed (or failed, continuing anyway)"

# Start the application
echo "Starting AdonisJS application..."
exec "$@"


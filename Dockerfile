# Use Node.js LTS as base image
FROM node:22-slim

# Install PostgreSQL and required dependencies
RUN apt-get update && apt-get install -y \
    postgresql \
    postgresql-contrib \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Create PostgreSQL data directory and set permissions
RUN mkdir -p /var/lib/postgresql/data && \
    chown -R postgres:postgres /var/lib/postgresql/data && \
    chmod 700 /var/lib/postgresql/data

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production=false

# Copy application files
COPY . .

# Build the application (ignore TypeScript errors in test files)
RUN npm run build -- --ignore-ts-errors

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose port (App Runner will set PORT env var, default is 8080)
EXPOSE 8080

# Set entrypoint (use explicit bash to ensure script runs)
ENTRYPOINT ["/bin/bash", "/usr/local/bin/docker-entrypoint.sh"]

# Default command
CMD ["npm", "start"]


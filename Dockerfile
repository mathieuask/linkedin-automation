FROM node:20-slim

# Install Chromium, Xvfb, and other dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    xvfb \
    fonts-liberation \
    libnss3 \
    libxss1 \
    libasound2 \
    libgbm1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create directories for volumes
RUN mkdir -p /app/chrome-profile /app/logs

# Set environment variables for Playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV DISPLAY=:99

# Launch Xvfb and the daemon
CMD Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp & \
    sleep 2 && \
    node daemon.js

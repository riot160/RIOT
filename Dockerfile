FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p sessions database

# Expose port
EXPOSE 3000

# Start the bot
CMD ["npm", "start"]

#!/bin/sh

# Load environment variables from .env file
# export $(grep -v '^#' .env | xargs)
# Start the application
node dist/index.js
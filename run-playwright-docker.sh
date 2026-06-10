#!/bin/bash

# Exit on error
set -e

# Ensure X server allows connections from localhost
xhost +local:

# Build the Playwright Docker image with current user ID
docker build \
  --build-arg USER_ID=$(id -u) \
  --build-arg GROUP_ID=$(id -g) \
  -t playwright-x11 \
  -f playwright.dockerfile . && \
# Run the container with X11 forwarding
docker run -it --rm \
  -v /tmp/.X11-unix:/tmp/.X11-unix \
  -v $HOME/.Xauthority:/home/playwright/.Xauthority \
  -v $(pwd):/app \
  -e DISPLAY \
  -p 9323:9323 \
  --ipc=host \
  playwright-x11 

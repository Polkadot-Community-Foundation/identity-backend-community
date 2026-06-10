FROM mcr.microsoft.com/playwright:v1.51.1-jammy

# Install additional dependencies
RUN apt-get update && apt-get install -y \
    x11-apps \
    xauth \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user to match the host user
ARG USER_ID=1000
ARG GROUP_ID=1000

# Handle existing group
RUN if getent group $GROUP_ID > /dev/null 2>&1; then \
        groupmod -n playwright $(getent group $GROUP_ID | cut -d: -f1); \
    else \
        groupadd -g $GROUP_ID playwright; \
    fi

# Handle existing user
RUN if id -u pwuser > /dev/null 2>&1; then \
        usermod -l playwright -u $USER_ID -g $GROUP_ID pwuser; \
    else \
        useradd -u $USER_ID -g playwright -m playwright; \
    fi

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Enable corepack for pnpm
RUN corepack enable

WORKDIR /app
RUN chown playwright:playwright /app

USER playwright

RUN corepack pnpm dlx playwright install chromium

# We'll mount the source code at runtime
CMD ["bash"]

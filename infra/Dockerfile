FROM node:20-slim

# System dependencies
RUN apt-get update && apt-get install -y \
    tmux \
    git \
    curl \
    jq \
    unzip \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install AWS CLI (needed for Secrets Manager in entrypoint)
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws/

# Install Hive from local source
COPY --chown=root:root . /tmp/hive-src
RUN cd /tmp/hive-src && npm install && npm run build && npm link && rm -rf /tmp/hive-src/node_modules/.cache

# Create non-root user (Claude Code refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash hive && \
    mkdir -p /workspace && chown hive:hive /workspace

# Entry point script
COPY infra/entrypoint.sh /opt/entrypoint.sh
RUN chmod +x /opt/entrypoint.sh

USER hive
WORKDIR /workspace

ENTRYPOINT ["/opt/entrypoint.sh"]

#!/bin/bash
# AWS EC2 User Data Script for MediPulse
# This script runs automatically on first boot when you launch an Ubuntu EC2 instance.

# 1. Update packages and install prerequisites
apt-get update -y
apt-get install -y ca-certificates curl gnupg git

# 2. Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# 3. Set up the Docker repository
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# 4. Install Docker Engine and Docker Compose
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-compose

# 5. Start and enable Docker service
systemctl start docker
systemctl enable docker

# 6. Add ubuntu user to docker group (so you don't need sudo docker)
usermod -aG docker ubuntu

# --- Deployment ---
# Note: You should SSH into your machine, git clone your private repository,
# setup your .env files, and run the following command manually to start the server:
# docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

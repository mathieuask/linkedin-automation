#!/bin/bash

# Script de rapport quotidien LinkedIn pour Telegram
# Appelé par un cron OpenClaw

cd /root/.openclaw/workspace-prospection/linkedin-automation

# Génère le rapport et capture la sortie
node scripts/smart-cli.js report

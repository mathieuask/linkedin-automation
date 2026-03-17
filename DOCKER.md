# Docker Deployment Guide

## 🐳 Build & Run

### 1. Configuration

Assure-toi que ton fichier `.env` est correctement configuré :

```bash
cp .env.example .env
nano .env
```

Variables obligatoires :
- `LI_AT` : Token LinkedIn
- `JSESSIONID` : Token CSRF LinkedIn
- `NOTION_TOKEN` : Token Notion
- `NOTION_DEALS_DB_ID` : ID de la base Deals
- `TELEGRAM_BOT_TOKEN` : Token du bot Telegram
- `TELEGRAM_CHAT_ID` : ID du chat Telegram

### 2. Build de l'image

```bash
docker-compose build
```

### 3. Lancement

```bash
docker-compose up -d
```

### 4. Logs en temps réel

```bash
docker-compose logs -f linkedin-bot
```

### 5. Arrêt

```bash
docker-compose down
```

## 📂 Volumes persistants

- `./chrome-profile:/app/chrome-profile` — Session Chrome persistante
- `./logs:/app/logs` — Logs de l'application

## 🔧 Troubleshooting

### Le bot ne démarre pas

```bash
# Vérifier les logs
docker-compose logs linkedin-bot

# Vérifier que les variables d'environnement sont bien chargées
docker-compose exec linkedin-bot env | grep LI_AT
```

### Erreur Playwright/Chromium

Le Dockerfile installe Chromium système. Si problème :

```bash
# Reconstruire l'image sans cache
docker-compose build --no-cache
```

### Accès aux fichiers Chrome

```bash
# Les données Chrome sont dans ./chrome-profile
ls -la ./chrome-profile
```

## 🚀 Production

Pour déployer sur un VPS :

1. Clone le repo
2. Configure `.env`
3. Lance `docker-compose up -d`
4. Configure un reverse proxy (optionnel, si API REST)

## 🔄 Mise à jour

```bash
git pull
docker-compose down
docker-compose build
docker-compose up -d
```

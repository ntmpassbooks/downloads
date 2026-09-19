@echo off
cd /d "%~dp0"
set NODE_ENV=production
node dist/server.js

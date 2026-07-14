@echo off
cd /d "%~dp0"
node audit-transferencias-ipr223.js > audit-transferencias-ipr223.console.txt 2>&1
exit

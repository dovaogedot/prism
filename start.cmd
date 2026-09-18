@echo off
rem Runs start.ps1 whatever the machine's PowerShell script policy is.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*

@echo off
echo ========================================
echo   NexRadar Pro - Pre-Push Security Check
echo ========================================
echo.

echo Checking for sensitive files...
echo.

REM Check for .env files
echo [1/5] Checking for .env files...
if exist .env (
    echo    ❌ WARNING: .env file found! DO NOT COMMIT!
    echo    Run: git rm --cached .env
) else (
    echo    ✅ No .env file in root
)

if exist frontend\.env.local (
    echo    ❌ WARNING: frontend/.env.local found! DO NOT COMMIT!
    echo    Run: git rm --cached frontend/.env.local
) else (
    echo    ✅ No .env.local in frontend
)
echo.

REM Check for node_modules
echo [2/5] Checking for node_modules...
if exist frontend\node_modules (
    echo    ⚠️  node_modules exists (should be in .gitignore)
) else (
    echo    ✅ No node_modules found
)
echo.

REM Check for __pycache__
echo [3/5] Checking for Python cache...
if exist backend\__pycache__ (
    echo    ⚠️  __pycache__ exists (should be in .gitignore)
) else (
    echo    ✅ No __pycache__ found
)
echo.

REM Check for dist folder
echo [4/5] Checking for build outputs...
if exist frontend\dist (
    echo    ⚠️  dist folder exists (should be in .gitignore)
) else (
    echo    ✅ No dist folder found
)
echo.

REM Check git status
echo [5/5] Checking git status...
git status --short
echo.

echo ========================================
echo   Security Check Complete
echo ========================================
echo.
echo ✅ If you see only green checkmarks above, you're safe to push!
echo ❌ If you see any red warnings, fix them before pushing!
echo.
echo Next steps:
echo   1. Review the files listed above
echo   2. If safe, run: git add .
echo   3. Then run: git commit -m "Your message"
echo   4. Finally run: git push
echo.
pause

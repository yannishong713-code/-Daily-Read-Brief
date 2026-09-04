@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === Pushing "laoma-daily" to GitHub ===
echo A browser window may open. Sign in to GitHub and Allow.
echo If nothing happens, check the window behind this one.
echo.
git push -u origin main
echo.
echo === Finished ===
echo If you see "error" above, copy this whole window and send it back.
echo If you see "branch 'main' set up to track", it worked.
echo.
pause

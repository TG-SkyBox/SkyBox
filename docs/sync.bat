@echo off
REM Script to reset 'featured' branch to match main

REM 1. Switch to main and pull latest
git switch main
git pull origin main

REM 2. Delete local featured branch if it exists
git branch -D featured 2>nul

REM 3. Delete remote featured branch if it exists
git push origin --delete featured

REM 4. Recreate featured branch from main
git switch -c featured

REM 5. Push new featured branch to remote
git push -u origin featured

echo Featured branch has been reset ✅
pause
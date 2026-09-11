@echo off
rem ===========================================================================
rem  Double-click this to put LockedIn on your Discord profile.
rem
rem  It asks for a duration, then keeps your status live until you close it.
rem  Closing the window clears the status - that is deliberate, not a crash.
rem  A status that outlived the session would be telling people you are
rem  studying when you stopped hours ago.
rem
rem  Typing the duration here beats passing it on a command line: a session
rem  link has an & in it, and a shell cuts a link at the first & unless it is
rem  quoted. Nothing typed at a prompt goes through a shell, so paste away.
rem ===========================================================================

cd /d "%~dp0"

python presence.py %*

echo.
echo ----------------------------------------------------------------
echo  Status cleared. You can close this window.
echo ----------------------------------------------------------------
pause

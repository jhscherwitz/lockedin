/* ==========================================================================
   LockedIn - entry point

   This file does two things: it pulls every module in, and it decides the
   order they start up in.

   Those are separate jobs, and keeping them separate is the whole reason the
   split works. Importing a module only *defines* what is in it. Nothing runs
   until the init calls at the bottom, by which point every module has
   finished loading and every binding exists.

   That discipline is not decoration. The modules genuinely import each other
   in circles - the timer needs the alarm, the alarm needs the timer; settings
   needs saving, saving needs settings. Circular imports are legal and work
   fine, but only as long as nothing *executes* across the circle while the
   modules are still initialising. The first attempt at this split did exactly
   that: appearance.js called applyTheme() at module scope, which called
   render() in timer.js, which read a const that timer.js had not reached yet.
   "Cannot access 'settings' before initialization".

   So: modules define on load, and do when told.
   ========================================================================== */

import "./audio.js";
import "./toast.js";
import "./keys.js";
import "./timer.js";
import "./alerts.js";
import "./pip.js";
import "./games/wordle.js";
import "./games/game2048.js";
import "./games/blackjack.js";
import "./games/minesweeper.js";
import "./games/sequence.js";
import "./games/snake.js";
import "./games/dino.js";
import "./games/sudoku.js";

import { initClock } from "./clock.js";
import { initPanels } from "./panels.js";
import { initSettings } from "./settings.js";
import { initSounds } from "./sounds.js";
import { initAppearance } from "./appearance.js";
import { initTasks } from "./tasks.js";
import { initCalculator } from "./calculator.js";
import { initCalendar } from "./calendar.js";
import { initMusic } from "./music.js";
import { initGames } from "./games/shell.js";
import { initMotion } from "./motion.js";
import { initSession } from "./session.js";
import { initStorage } from "./storage.js";
import { initSync } from "./sync.js";

/* Order matters here in a way it did not inside one file.

   Everything that draws itself has to be built before anything reads or
   writes it, and saved state has to land last - initStorage() applies what
   was in localStorage on top of the defaults, so every control it touches
   must already exist. */

initClock();
initPanels();
initSettings();
initSounds();
initAppearance();
initTasks();
initCalendar();
initCalculator();
initMusic();
initGames();

initStorage(); // replays the saved state over everything above

/* Before initSession, which needs our channel id the moment the share button
   is wired, and which hands off to joinChannel once it has joined. */
initSync();

/* After storage, because a shared session deliberately overrides the timer
   settings that storage has just restored - it is the more specific
   instruction, so it goes last of the two. */
initSession();

/* After initStorage, deliberately. Motion reads the timer's rendered state
   to decide what to animate, and the saved session is applied above - start
   it any earlier and the entrance plays against the defaults, then the
   restored values snap in over the top of it. */
initMotion();

// Grab the two elements we're going to keep updating.
const clockEl = document.getElementById("clock");
const greetingEl = document.getElementById("greeting");

// Pick a greeting based on the hour (0-23).
function greetingFor(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function updateClock() {
  const now = new Date();

  const hours24 = now.getHours();

  // Convert 24-hour to 12-hour. The `|| 12` turns midnight (0) into 12.
  const hours12 = hours24 % 12 || 12;

  // padStart makes 9:5 display as 9:05.
  const minutes = String(now.getMinutes()).padStart(2, "0");

  clockEl.textContent = `${hours12}:${minutes}`;
  greetingEl.textContent = greetingFor(hours24);
}

// Run once immediately, otherwise the page shows "--:--" for a full second.
updateClock();

// Then re-run every 1000 milliseconds, forever.
setInterval(updateClock, 1000);

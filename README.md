# Stones Unturned

A personal map of things worth turning over: Events (exhibitions, places, screenings, pop-ups…) pinned by emoji collection, a filterable list, and a day-planning calendar. Data lives in a separate private repo and is synced through the GitHub API; a daily Claude routine finds new Events.

Static site, no build step: `index.html`, `style.css`, `js/`. Local testing: `node dev/serve.mjs --data <copy of the data folder>` then open `http://localhost:8790/?api=http://localhost:8790`.

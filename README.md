# PsycUp Web

Psychiatrie-Neuigkeiten aus aller Welt und Leitlinien nach Krankheitsbild, als Web-App zum Installieren auf dem Handy.

Öffnen: https://oldkaradal.github.io/PsychUp-Web/

- `web/` ist die App (eine HTML-Seite, Offline-Speicher über `sw.js`).
- `scripts/fetch-news.mjs` holt die RSS-Feeds und schreibt `web/data/news.json`.
- `.github/workflows/web.yml` läuft alle 3 Stunden, holt die Neuigkeiten und veröffentlicht die Seite über GitHub Pages.

Die Android-App liegt im privaten Repo `PsychUP`.

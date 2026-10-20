# Kwick-Study

A speed-reading web app built around how memory works: read in Pomodoro focus rounds, test yourself straight after, turn what you missed into flashcards, and plan how you'll use what you learned with scheduled checkups.

## What it does

| Step | What happens |
| --- | --- |
| **i. Read** | Text slides past a focus marker (or flashes one word at a time) at 100–1000 words per minute (150 by default), slowing at punctuation. Upload a PDF, `.txt` or `.md` file, or paste text. For PDFs you can pick a page range. |
| **Pomodoro** | 25-minute focus rounds, 5-minute breaks, a 15-minute break after four rounds (all adjustable). The reader locks during breaks. |
| **ii. Recall** | Write what you remember without looking. The app scores how many key ideas you recalled and suggests fill-in-the-blank cards for the ones you missed. |
| **iii. Apply** | Jim Kwik's four questions: *What did I learn? How can I use this? When will I use this? Why must I use this?* Saved as a takeaway with checkups after 1, 3, 7, 14, 30, 60 and 120 days. |
| **iv. Review** | Due checkups and flashcards (spaced repetition: Again / Hard / Good / Easy). |
| **v. Progress** | Pomodoros, words read, speed, recall, takeaways and times applied, plus a chart of speed against effective speed (speed × recall). |

PDF text is extracted in the browser with [pdf.js](https://mozilla.github.io/pdf.js/) 3.11.174, loaded from cdnjs the first time you open a PDF and cached for offline use after that.

## Data

Everything is stored in the browser's `localStorage` on the device you use. Nothing is sent to a server. Use **Settings → Export backup** to save a JSON copy and **Import backup** to restore it or move it to another device.

## Running locally

No build step. Serve the folder with any static server:

```bash
npm start          # serves on http://localhost:5173
npm run check      # syntax-checks the scripts
```

Opening `index.html` directly from disk also works, but offline support (the service worker) only runs when served over http(s).

## Deploying

It's a static site: upload the folder to any static host (Vercel, Netlify, GitHub Pages, Render static sites, Cloudflare Pages). No environment variables are needed. Once served over HTTPS, it can be installed to a phone's home screen and works offline.

## Structure

```
index.html              markup
css/styles.css          styles (light and dark themes)
js/app.js               all app logic
sw.js                   service worker for offline use
manifest.webmanifest    install metadata
icons/                  app icons
```

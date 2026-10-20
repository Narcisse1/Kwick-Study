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

## Data and accounts

Without an account, everything is stored in the browser's `localStorage` on that device. **Settings → Export backup** saves a JSON copy and **Import backup** restores it.

With a free account (the **Sign in** button, or `/#account`), study data also syncs across devices through [Supabase](https://supabase.com). Each flashcard, takeaway, session, day and the settings is one row in `user_docs`; when two devices edit the same item, the most recent edit wins. The sign-up form has an opt-in newsletter checkbox (off by default); the consent time is recorded by the database. People can unsubscribe, sign out (optionally clearing the browser) and delete their account from the Account page.

### Setting up accounts (one time)

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste `supabase/schema.sql` and run it.
3. **Authentication → URL Configuration**: set **Site URL** to your deployed address (e.g. `https://kwick-study.vercel.app`) and add it under **Redirect URLs** too. Confirmation and password-reset links return there.
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key into `js/config.js`. The anon key is meant to be public; row-level security in the schema keeps each person's data private. Never put the `service_role` key in this app.
5. Optional: Supabase's built-in email sender is rate-limited and meant for testing. For real users, add your own SMTP under **Authentication → Emails → SMTP Settings**.

If `js/config.js` is left empty, the app runs without accounts.

### Exporting newsletter subscribers

In **SQL Editor**, run the query at the bottom of `supabase/schema.sql` (confirmed accounts that opted in, with their consent time), then use **Download CSV**.

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
js/config.js            Supabase URL and anon key (empty = no accounts)
supabase/schema.sql     database tables, security rules and triggers
sw.js                   service worker for offline use
manifest.webmanifest    install metadata
icons/                  app icons
```

## Design

**Logo.** A brain whose two halves sit on an open book. The left half shows the folds of the brain, where knowledge is stored. The right half shows lines of text: reading turning into memory. The book's spine runs through the middle, so reading and memory meet there. The red dot at the top is the fixation point, the single spot your eyes rest on while the text slides past.

**Colour.** Based on colour-psychology research:

- **Blue** (brand, buttons, progress) is linked to calm, open, approach-minded focus. In Mehta & Zhu's 2009 *Science* study, blue doubled creative output compared with red.
- **Red** appears only where attention to detail and recall matter: the fixation point, focus time, and ideas you missed. The same study found red improved detail-oriented tasks such as memory retrieval.
- **Green** marks growth and rest: applying what you learn, remembered answers, breaks. Lichtenfeld et al. (2012) found that a glimpse of green improved creative performance, and linked green to the motivation to improve and grow.

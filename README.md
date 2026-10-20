# Bujji Mail

A privacy-first, browser-based email triage prototype. Import `.eml` files and inspect locally generated action cues and urgency cues.

## Privacy and scope

- Email files are processed in your browser; the app has no backend or email-upload endpoint.
- No analytics, AI API, mailbox connection, or third-party runtime dependency.
- Imported messages are held in page memory only. Refreshing or closing the tab clears them.
- This prototype reads `.eml` files only. It does not connect to an inbox, send email, extract attachments, or provide a security verdict.
- Heuristic action/urgency cues are suggestions, not guaranteed classifications. Review the original email before acting.
- Never import confidential mail on a shared or untrusted computer.

## Try a synthetic sample

Download [examples/sample.eml](./examples/sample.eml) and import it into the app. It uses reserved `.test` addresses and contains no real correspondence.

## Run locally

Use any static web server from this folder, for example:

```powershell
python -m http.server 8000
```

Open http://localhost:8000.

## Test

Requires Node.js 20 or later:

```powershell
npm test
```

## Deployment

The GitHub Actions workflow runs the parser tests and JavaScript syntax checks, then publishes the static site to GitHub Pages on pushes to `main`. The first deployment may need repository Actions permissions to be enabled by the owner.

## Project status

This repository currently contains the browser-side prototype and does not yet bundle the existing BujjiMail-DeepSeek Python engine or its reported 185-test suite. Those must be integrated from the authorized local project and verified separately before calling this a complete release.

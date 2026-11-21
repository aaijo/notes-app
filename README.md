# notes-app

Personal notes / checklists / mind-dump PWA. Data lives as plain Markdown files in a folder on the device
(synced to the Mac with Syncthing) — nothing is stored on a server.

- App: https://aaijo.github.io/notes-app/ (install from Chrome's menu → "Install app")
- Demo without a folder (browser storage only): https://aaijo.github.io/notes-app/?demo
- Folder access test: https://aaijo.github.io/notes-app/folder-test/

## Checklists

Each checklist is `checklists/<name>.md` inside the chosen folder:

```markdown
# Weekend packing

- [ ] Rain jacket
- [x] Passport
```

Any other lines in the file are kept as they are, so editing on the Mac is safe.

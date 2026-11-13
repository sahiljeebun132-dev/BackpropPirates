# Data

The rules say every number in the app must come from a real dataset, so this folder keeps the trail from source to app.

| Folder | What goes in it |
|---|---|
| `data/raw/` | Files exactly as downloaded. Never edit these by hand |
| `scripts/` | Cleaning scripts that read `data/raw/` and write `public/data/` |
| `public/data/` | Clean JSON the app loads |

For every dataset, note in the README's **Data sources** table: the title, publisher, URL, download date, licence, and what the cleaning script changed.

Note: data.govmu.org sits behind a bot check, so download files in a normal browser. Many of the same official files are mirrored on Hugging Face (`electricsheepafrica/africa-mauritius-*`).

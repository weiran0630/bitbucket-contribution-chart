# Bitbucket Contribution Chart

Chrome extension that adds a **GitHub-style contribution heatmap** to your Bitbucket Cloud profile.
<img width="1294" height="98" alt="image" src="https://github.com/user-attachments/assets/44744272-da68-49c7-a197-ced8280ead66" />


## Features

- Green calendar grid for the last year of commit activity
- Aggregates commits across all repositories you can access
- Caches results for 6 hours
- Options page for API token setup

## Install (development)

```bash
cd bitbucket-contribution-chart
npm install
npm run build
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist` folder

For development with hot reload:

```bash
npm run dev
```

Load the `dist` folder the same way; CRXJS rebuilds on file changes.

## Setup

1. Open extension **Options** (right-click the icon → Options, or from `chrome://extensions`)
2. Enter your **Atlassian account email**
3. Create a [Bitbucket API token](https://id.atlassian.com/manage-profile/security/api-tokens) with:
   - **read:user:bitbucket**
   - **read:workspace:bitbucket**
   - **read:repository:bitbucket**
4. Click **Test connection**, then **Save**
5. On any Bitbucket page, click the **extension icon** in the toolbar to show or hide the contribution popover

## How it works

Bitbucket has no contribution-calendar API. The extension:

1. Lists your workspaces (`GET /2.0/user/workspaces`)
2. Lists member repos per workspace (`GET /2.0/repositories/{workspace}?role=member`)
3. Paginates commits per repo and filters by your `account_id`
3. Buckets commits by local calendar day
4. Renders a heatmap similar to GitHub's profile graph

## Limitations

- **Commits only** — pull requests and issues are not counted
- **Your profile only** — chart shows on your own profile page
- **Accessible repos** — private work repos count only if your token can read them
- **First load** can take several minutes on large accounts; cached visits are fast
- **Partial data** — repos with very long history may hit per-repo page limits (warning shown)

## Credentials

Email and API token are stored in `chrome.storage.sync` on your device. No data is sent to third-party servers.

## License

MIT

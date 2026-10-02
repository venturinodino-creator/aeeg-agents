# AEEG Agents

A live page for following what is happening on African Earth Energy Group (AEEG) work: the repos and the agents running in them. It shows only the AEEG repos and needs no personal token.

Live at https://venturinodino-creator.github.io/aeeg-agents/

## What counts as an agent
An agent is a GitHub workflow that runs on a schedule or is started by hand. Add one to an AEEG repo and it appears on the page by itself, with its latest result and recent runs.

CI, pull-request checks and GitHub's own Pages deploy are not agents. They still affect a repo's health colour, but they are not listed as agents. Today there are no agents in the AEEG repos, and the page says so.

## Which repos appear
`config.json` holds the list of repos, by exact name. To add or remove one, edit that list and run the snapshot. A name with no matching repo stops the snapshot with an error and keeps the previous data, so a typo can never publish the wrong thing. Repos not on the list are never published.

## How it works without a token
A GitHub Action in this repo runs every hour. It uses GitHub's built-in credentials to collect commits and workflow runs from the listed public repos and saves them to `data.json`. The page reads that one file, so it makes no GitHub API calls and never hits the rate limit.

- **Refresh now:** Actions tab → **AEEG Agents snapshot** → **Run workflow**.
- **Tests:** `node --test tests/*.test.mjs` (also run by the Action before each snapshot).

## Notes
- **If a refresh fails**, the page keeps showing this browser's last good copy with a notice. If the data is more than 3 hours old it says so, which means the hourly Action is failing: check the Actions tab. If there is no copy at all, the page shows nothing rather than sample data.
- **Coding activity** is Claude's commits and pull requests. It is shown next to the agents but is never counted as one.
- This repo and its page are public, so anyone with the link can see them.
- Repos with no activity in the last 60 days are listed, but their details aren't fetched.
- Private repos aren't included, because the built-in credentials can only see public ones.

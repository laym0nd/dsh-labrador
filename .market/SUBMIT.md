# Getting this plugin into dsh-market

Researched, not guessed. Sources: the `dshmarket` package's own README (the market
application), and `awesome-dsh-plugin/awesome-dsh-plugin`'s `contributing.md` (the
registry). Both read on 2026-09-14.

## How listing actually works

**dsh-market is the application, not the catalogue.** Its README says so plainly:

> This repo is the market app, not the catalog. The plugin list comes from the
> curated awesome-dsh-plugin registry — to get your plugin listed in the market,
> open a PR **there**.

The market fetches `https://awesome-dsh-plugin.com/plugins.json` live on every open.
Listing therefore means one pull request against the registry, and nothing at all
against the market. The market picks it up by itself, usually within a day.

## What the registry requires

From `contributing.md`:

- The repository declares a **`dsh.bundle` manifest** in `package.json`. This is what
  makes it installable with `dsh plugin add`. The most common reason for rejection is
  declaring only `dsh.client` — which is not installable on its own. **This plugin
  declares both.**
- A `cordis.patch.yml` next to it. **Present.**
- Real, working code; no placeholders or README-only repositories. **Present.**
- The repository is **at least one day old**. Checked automatically. It filters out
  repositories created minutes before the PR. ⚠️ **This is the one bar not yet met** —
  the repository has to exist for a day before the pull request is worth opening.
- The project is actively maintained.
- The `dsh-plugin` **GitHub topic** added to the repository.
- A description stating what the plugin does, with no marketing language, and
  **accurate** — it is checked against the source.
- A category that matches what the plugin does. `fun` is where the other pets are,
  including the official `dsh-pet`.

## The pull request

One file, at `data/plugins/laym0nd__dsh-labrador.yml`. That file is prepared beside
this one, ready to copy with no changes: the name matches the repository and the
repository matches the entry.

The READMEs in that repository are generated from `data/plugins/*.yml` — do not edit
them by hand. One file per plugin is the whole submission, and it is designed so that
concurrent submissions never conflict.

## Order of work

1. **Create the GitHub repository** — `laym0nd/dsh-labrador`, public, and *empty*:
   no README, no .gitignore, no licence, because this repository already has all
   three and a pre-filled one would conflict on the first push.
2. **Push.** Git Credential Manager is installed and will open a browser window to
   authorise the push:

   ```sh
   git remote add origin https://github.com/laym0nd/dsh-labrador.git
   git push -u origin main
   ```

3. **Add the `dsh-plugin` topic** to the repository, on its GitHub page. The registry
   expects it.
4. **Wait a day** from the repository's creation. The one-day rule is checked by CI
   and cannot be argued with.
5. **Open the pull request**: fork `awesome-dsh-plugin/awesome-dsh-plugin`, add
   `data/plugins/laym0nd__dsh-labrador.yml`, and open the PR. Nothing else belongs in
   it.

## Optional: publishing to npm

The market installs from npm first, then from a GitHub release tarball, then from the
repository source. A GitHub-only listing works, and this plugin needs no build step at
all, so a source install is clean — but an npm package installs faster, and the
registry entry can then carry an `npm` field. `package.json` is ready either way:

```sh
npm publish
```

If you do publish, add `npm: dsh-labrador` to the registry entry.

# Bundled Photon skills

These scrubbed skill files were copied from:

- Repository: https://github.com/photon-hq/skills.git
- Snapshot commit: `abf227fdec233d654b4198293e5901207c6d8332`
- Photon CLI skill: https://github.com/photon-hq/skills/tree/main/skills/photon-cli

Included skills:

- `photon-cli/` — install and use the `photon` CLI for project, Spectrum, and line setup.
- `spectrum/` — Spectrum SDK and messaging guidance.
- `imessage/` — iMessage SDK and provider guidance.

On the agent VM, install them with the upstream guidance:

```bash
npx skills add photon-hq/skills --skill photon-cli
npx skills add photon-hq/skills --skill spectrum
npx skills add photon-hq/skills --skill imessage
```

Or copy these directories into the VM's agent skills directory (for example `$HOME/.agents/skills/`). Then read `photon-cli/SKILL.md` before driving Photon setup. No live tokens, project secrets, phone numbers, or credentials are included.

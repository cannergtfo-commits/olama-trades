# Ollama project hints

Open the **repo root** (parent of this folder) as the workspace.

1. `ollama pull qwen2.5-coder:14b`
2. Optional custom model: `ollama create olama-trades -f ../Modelfile`
3. Read `../AGENTS.md` and `../commands.md`
4. First run: `npm run init-wallet` (creates gitignored keypair)

Default chat provider in `.env`: Ollama at `http://127.0.0.1:11434`.

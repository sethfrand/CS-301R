# RunRec

RunRec is a running shoe recommendation app with a FastAPI backend and a Vite/React frontend.

## Model Setup

Model access is configured on the backend. End users do not choose the model in the UI.

RunRec supports:

1. OpenAI
2. A local model exposed over Tailscale through an OpenAI-compatible API

Create a `.env` file in the project root, or export the same variables in your shell before starting `server.py`.

## Option 1: OpenAI

Set these variables:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your_openai_key_here
OPENAI_MODEL=gpt-5.4-nano
```

Notes:

- `OPENAI_API_KEY` is required for chat.
- `OPENAI_MODEL` is optional; if omitted, the backend defaults to `gpt-5.4-nano`.
- The shoe embedding search path also expects `OPENAI_API_KEY`.

## Option 2: Local Model Over Tailscale

Your local model server must be reachable from the machine running RunRec over your Tailscale network, and it must expose an OpenAI-compatible chat API.

Set these variables:

```bash
LLM_PROVIDER=local
LOCAL_LLM_BASE_URL=http://100.x.y.z:11434/v1
LOCAL_LLM_MODEL=your-model-name
LOCAL_LLM_API_KEY=
```

Notes:

- Replace `http://100.x.y.z:11434/v1` with your Tailscale IP or MagicDNS host and the correct port/path for your model server.
- `LOCAL_LLM_MODEL` must match the model name your server expects.
- `LOCAL_LLM_API_KEY` is optional. Leave it blank if your local endpoint does not require auth.
- Chat will use the local model, but semantic embedding retrieval still depends on `OPENAI_API_KEY`. If that key is missing, RunRec falls back to a simpler local catalog search.

## Example `.env` Files

OpenAI:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-nano
```

Local over Tailscale:

```bash
LLM_PROVIDER=local
LOCAL_LLM_BASE_URL=http://my-desktop.tailnet-name.ts.net:11434/v1
LOCAL_LLM_MODEL=qwen2.5:14b-instruct
LOCAL_LLM_API_KEY=
```

## Running The App

Backend:

```bash
python3 server.py
```

Frontend:

```bash
cd shoe-chatbot
npm install
npm run dev
```

By default, the frontend runs on `http://localhost:5173` and the backend on `http://localhost:8000`.

## User Connection Flow

Once the backend model is configured and running, the user can open the app and use the existing Connect tab for data providers:

1. Set a PIN
2. Connect Strava if desired
3. Connect Intervals.icu if desired
4. Use chat and dashboard features

The user does not need to enter model credentials in the UI.

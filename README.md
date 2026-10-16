# PitchMind

A team of AI agents that watches a football match, talks about it, and checks every claim before it speaks.

Built for the Microsoft x Premier League "Inside the Game" Developer Hackathon.
All data is synthetic. Clubs, players and matches are fictional.

## The agents

| Agent | Job |
|---|---|
| Lead | Plans the match and hands work to the others |
| Analyst | Reads raw events and finds patterns |
| Proof | Checks every claim against the raw events. No proof, no speech |
| Story | Writes short, fun commentary synced to the play |
| Recap | Writes the full time summary |
| Fan | Answers fan questions about the match |
| Scout | Builds a fictional club from a short brief |

Built with Microsoft Agent Framework on Microsoft Foundry (gpt-4o).

## Game layer

Sign in as a manager, build a club with the Scout agent, share a join code, chat with club mates, play rivals, climb the ladder and win trophies. Matches play in a 3D stadium.

## Architecture

```
Browser (Next.js 15, 3D stadium)
   |  SSE stream
FastAPI backend (Azure Container Apps)
   |-- Match engine (synthetic events)
   |-- Agent team (Microsoft Agent Framework)
   |        '-- Microsoft Foundry (gpt-4o)
   '-- League store
            '-- Azure Cosmos DB (Entra ID auth only)
```

## Run locally

Backend:

```
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
az login
copy .env.example .env   # fill in the values
uvicorn main:app --port 8000
```

Frontend:

```
cd web
npm install
npm run dev
```

Open http://localhost:3000

Without `COSMOS_ENDPOINT` the league saves to a local JSON file.

## Deploy to Azure

```
.\deploy\deploy.ps1
```

This creates the Container Apps, Cosmos DB, and role assignments from `deploy/pitchmind.json`.

## Data

Everything is synthetic. No real clubs, players or Premier League data is used.

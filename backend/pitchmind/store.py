"""Where the league lives.

CosmosStore: Azure Cosmos DB for NoSQL, serverless, signed in with Entra ID (managed identity in
Azure, your az login locally). No keys. Used when COSMOS_ENDPOINT is set.
FileStore:   one JSON file. Used for local runs without Cosmos.

Both keep the same shape: {"users": {id: doc}, "clubs": {id: doc}}. Only documents that changed
since the last save are written, so a chat message is one small upsert.
"""
import hashlib
import json
import os
from pathlib import Path

KINDS = {"users": "user", "clubs": "club"}


def _digest(doc) -> str:
    return hashlib.sha1(json.dumps(doc, sort_keys=True).encode()).hexdigest()


class FileStore:
    kind = "file"

    def __init__(self, path: Path):
        self.path = path

    def load(self) -> dict:
        if self.path.exists():
            try:
                return json.loads(self.path.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {"users": {}, "clubs": {}}

    def save(self, db: dict):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(db), encoding="utf-8")
        tmp.replace(self.path)


class CosmosStore:
    kind = "cosmos"

    def __init__(self, endpoint: str, database: str = "pitchmind", container: str = "league"):
        from azure.cosmos import CosmosClient
        from azure.identity import AzureCliCredential, DefaultAzureCredential

        cred = AzureCliCredential() if os.environ.get("USE_AZURE_CLI", "1") == "1" else DefaultAzureCredential()
        self.client = CosmosClient(endpoint, credential=cred)
        self.c = self.client.get_database_client(database).get_container_client(container)
        self.seen: dict[tuple[str, str], str] = {}  # (pk, id) -> digest of what Cosmos holds

    def load(self) -> dict:
        db = {"users": {}, "clubs": {}}
        back = {v: k for k, v in KINDS.items()}
        for item in self.c.query_items("SELECT c.id, c.pk, c.doc FROM c", enable_cross_partition_query=True):
            group = back.get(item.get("pk"))
            if group:
                db[group][item["id"]] = item["doc"]
                self.seen[(item["pk"], item["id"])] = _digest(item["doc"])
        return db

    def save(self, db: dict):
        live = set()
        for group, pk in KINDS.items():
            for did, doc in db[group].items():
                live.add((pk, did))
                d = _digest(doc)
                if self.seen.get((pk, did)) != d:
                    self.c.upsert_item({"id": did, "pk": pk, "doc": doc})
                    self.seen[(pk, did)] = d
        for pk, did in [k for k in self.seen if k not in live]:
            try:
                self.c.delete_item(did, partition_key=pk)
            except Exception:
                pass
            self.seen.pop((pk, did), None)


def make_store():
    ep = os.environ.get("COSMOS_ENDPOINT", "").strip()
    if ep:
        return CosmosStore(ep, os.environ.get("COSMOS_DATABASE", "pitchmind"), os.environ.get("COSMOS_CONTAINER", "league"))
    default = Path(__file__).resolve().parents[2] / "data" / "league.json"
    return FileStore(Path(os.environ.get("STORE_PATH", default)))

"""Event publishing. When a match ends, the API drops a message on an Azure Storage Queue.
An Azure Function (see /functions) picks it up and settles the result on the server, so trophies
are applied even if the viewer closed the page. Without STORAGE_QUEUE_URL, nothing is published
and the caller settles in process instead.
"""
import json
import os

_client = None


def _queue():
    global _client
    if _client is None:
        url = os.environ.get("STORAGE_QUEUE_URL", "").strip()
        if not url:
            _client = False
            return _client
        from azure.identity import AzureCliCredential, DefaultAzureCredential
        from azure.storage.queue import QueueClient, TextBase64EncodePolicy
        cred = AzureCliCredential() if os.environ.get("USE_AZURE_CLI", "1") == "1" else DefaultAzureCredential()
        _client = QueueClient.from_queue_url(url, credential=cred, message_encode_policy=TextBase64EncodePolicy())
    return _client


def enabled() -> bool:
    try:
        return bool(_queue())
    except Exception:
        return False


def publish(kind: str, payload: dict) -> bool:
    """Send one event. Returns True if it was queued."""
    try:
        q = _queue()
        if not q:
            return False
        q.send_message(json.dumps({"type": kind, **payload}))
        return True
    except Exception as ex:
        print(f"[Events] publish failed: {type(ex).__name__}: {str(ex)[:120]}", flush=True)
        return False

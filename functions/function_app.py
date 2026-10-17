"""PitchMind settlement function.

Trigger: a message on the Azure Storage Queue `match-events`, published by the API at full time.
Job:     tell the API to settle the match (trophies, XP, ladder, club chat). The API call is idempotent,
         so retries are safe. If settling fails the message is retried, then moved to the poison queue.

Auth:    the queue connection uses the function's managed identity (StorageConn__queueServiceUri).
"""
import json
import logging
import os
import urllib.error
import urllib.request

import azure.functions as func

app = func.FunctionApp()


@app.queue_trigger(arg_name="msg", queue_name="match-events", connection="StorageConn")
def settle_match(msg: func.QueueMessage) -> None:
    event = json.loads(msg.get_body().decode("utf-8"))
    if event.get("type") != "match.completed":
        logging.info("Ignoring event type %s", event.get("type"))
        return
    match_id = str(event.get("match_id", ""))
    if not match_id.isalnum():
        logging.warning("Bad match id in event: %r", match_id)
        return
    api = os.environ["API_URL"].rstrip("/")
    req = urllib.request.Request(f"{api}/api/challenge/{match_id}/finish", data=b"{}", method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as ex:
        if ex.code == 404:  # match is gone from the API memory. Retrying will not help.
            logging.warning("Match %s not found on the API. Dropping the event.", match_id)
            return
        raise
    logging.info("Settled match %s: %s", match_id, json.dumps(body.get("result"))[:300])

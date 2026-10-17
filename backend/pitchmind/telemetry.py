"""Application Insights tracing for the agent team.

If APPLICATIONINSIGHTS_CONNECTION_STRING is set (it is in Azure), requests, dependencies and the
custom spans below are sent to Application Insights through OpenTelemetry. Without it, every call
here is a harmless no-op, so local runs need no setup.
"""
import os
from contextlib import contextmanager

_tracer = None
_enabled = False


def init():
    """Call once at startup. Safe to call when telemetry is not configured."""
    global _tracer, _enabled
    if _tracer is not None:
        return _enabled
    conn = os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING", "")
    try:
        from opentelemetry import trace
        if conn:
            from azure.monitor.opentelemetry import configure_azure_monitor
            configure_azure_monitor(connection_string=conn, logger_name="pitchmind")
            _enabled = True
            print("[Telemetry] Application Insights on", flush=True)
        _tracer = trace.get_tracer("pitchmind")
    except Exception as ex:  # tracing must never break the app
        print(f"[Telemetry] off: {type(ex).__name__}: {str(ex)[:100]}", flush=True)
        _tracer = False
    return _enabled


class _Noop:
    def set_attribute(self, *a, **k): pass
    def add_event(self, *a, **k): pass
    def record_exception(self, *a, **k): pass


@contextmanager
def span(name: str, **attrs):
    """Open a span. Attributes with value None are skipped."""
    if _tracer is None:
        init()
    if not _tracer:
        yield _Noop()
        return
    with _tracer.start_as_current_span(name) as sp:
        for k, v in attrs.items():
            if v is not None:
                sp.set_attribute(k, v)
        yield sp


def event(name: str, **attrs):
    """Add an event to the current span (for example an agent handoff)."""
    if not _tracer:
        return
    try:
        from opentelemetry import trace
        trace.get_current_span().add_event(name, {k: v for k, v in attrs.items() if v is not None})
    except Exception:
        pass

"""Third-party data providers behind one governed gateway.

The adapters here are simulated, but the interface, metering, caching and tiered-calling
behaviour are the ones production adapters implement. Nothing in the platform calls a vendor
directly: everything goes through :func:`app.providers.gateway.call`, which is what makes vendor
cost per boarding measurable and reducible (Credit & Risk strategy, Pillar 4).
"""

from app.providers.gateway import ProviderResult, call, spend_report

__all__ = ["ProviderResult", "call", "spend_report"]

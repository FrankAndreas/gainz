"""The family hub (FrankAndreas/family-hub): who is logged in, and the tracker's people (family-hub "For apps").

The hub's own client package (family-hub/client, "family-hub-client" in requirements.txt), set up with this app's key:
it asks the hub, keeps answers for a minute and knows the rules for logins from outside. Its fake hub
(family_hub_client.fake) stands in for the hub in the tests, and the hub's own tests keep it in step with the hub."""

from family_hub_client import (  # noqa: F401
    TIMEOUT_SECONDS,
    HubClient,
    HubPerson,
    HubUnavailable,
    Login,
    Session,
)

client = HubClient(default_app_key="fitness")

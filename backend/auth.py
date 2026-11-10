"""Who is logged in: the family hub's login, as in the sibling apps (family-planner's auth).

At home the browser sends the hub's cookie `hub_session` (set for local.<domain>, so every family app gets it); tests
and scripts may send the same token as `Authorization: Bearer`. The tracker is home only: a request that came through
the Cloudflare tunnel (it carries Cf-Connecting-Ip) is no login, whatever else it carries. Neither the cookie nor the
token belongs in a log: each is a hub login."""

import logging
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response, status

from backend import hub, hub_people

logger = logging.getLogger(__name__)

COOKIE = "hub_session"
# With the cookie, a change must carry this header: another page on the family's domain can make the browser send the
# cookie, but not a custom header
CSRF_HEADER = "X-Requested-With"
CSRF_VALUE = "fitness"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
RENEW_HEADER = "X-Hub-Renew"
TUNNEL_HEADER = "Cf-Connecting-Ip"


@dataclass(frozen=True)
class Person:
    """The logged-in person: their local id (the workouts folder) and their name from the hub."""

    id: str
    name: str


def api_error(status_code: int, code: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code})


def _not_logged_in() -> HTTPException:
    error = api_error(status.HTTP_401_UNAUTHORIZED, "not_logged_in")
    error.headers = {"WWW-Authenticate": "Bearer"}
    return error


def request_login(request: Request) -> tuple[hub.Login | None, bool]:
    """The request's hub login, and whether it came as the cookie (then a change needs the header)."""
    scheme, _, value = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() == "bearer" and value.strip():
        return hub.Login(value.strip()), False
    cookie = request.cookies.get(COOKIE)
    return (hub.Login(cookie), True) if cookie else (None, False)


def get_current_person(request: Request, response: Response) -> Person:
    """The person behind the request's hub login. A plain def: FastAPI runs it in a worker thread, so asking the hub
    and reading users.json don't block the event loop."""
    if TUNNEL_HEADER in request.headers:
        raise _not_logged_in()
    login, from_cookie = request_login(request)
    if login is None:
        raise _not_logged_in()
    if from_cookie and request.method not in SAFE_METHODS and request.headers.get(CSRF_HEADER) != CSRF_VALUE:
        raise api_error(status.HTTP_403_FORBIDDEN, "csrf")
    try:
        session = hub.client.session(login)
        if session.person is None:
            raise _not_logged_in()
        if not session.access:
            raise api_error(status.HTTP_403_FORBIDDEN, "no_access")
        hub_people.refresh(login)
        found = hub_people.entry(session.person.id)
        if found is None or found["name"] != session.person.name:
            # Given access a moment ago, or renamed: the people kept here may be older than that. A name that still
            # differs afterwards is the client's kept session (up to a minute old), not a reason to refuse
            hub_people.refresh(login, force=True)
            found = hub_people.entry(session.person.id)
        if found is None:
            # Another request of theirs was refreshing at the same moment: wait for it, then look again
            hub_people.wait_for_running(hub.TIMEOUT_SECONDS)
            found = hub_people.entry(session.person.id)
    except hub.HubUnavailable as error:
        logger.warning("The family hub can't be reached (%s)", error)
        raise api_error(status.HTTP_503_SERVICE_UNAVAILABLE, "hub_unavailable") from None
    if found is None:
        raise api_error(status.HTTP_403_FORBIDDEN, "no_access")
    if session.renew:
        # The hub login is in its last week: the page sends the browser once through the hub, which renews it
        response.headers[RENEW_HEADER] = "1"
    return Person(id=found["id"], name=found["name"])


# The logged-in person, as an endpoint parameter: `person: CurrentPerson`
CurrentPerson = Annotated[Person, Depends(get_current_person)]

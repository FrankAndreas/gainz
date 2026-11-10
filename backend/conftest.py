"""Every test gets its own data folder and a fake family hub (family_hub_client.fake), so the app's login and people go
through the real client. Invented people only: the repository is public."""

import pytest
from family_hub_client.fake import FakeHub

from backend import hub, hub_people, main, storage


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)
    main.initialize_data()
    yield tmp_path


@pytest.fixture(autouse=True)
def fake_hub(monkeypatch):
    fake = FakeHub(hub.client, on_change=hub_people.forget)
    monkeypatch.setattr(hub.client, "transport", fake)
    hub.client.forget()
    hub_people.forget()
    yield fake
    hub.client.forget()
    hub_people.forget()


@pytest.fixture
def login(fake_hub):
    """login(name) -> the request headers of that person's hub login, adding them to the hub first if needed."""

    def _login(name: str = "Andreas", **add_kwargs) -> dict[str, str]:
        if name not in fake_hub.people:
            fake_hub.add(name, **add_kwargs)
        return {"Authorization": f"Bearer tok-{name}"}

    return _login

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def test_hosted_web_preserves_api_and_guest_session(tmp_path, monkeypatch):
    (tmp_path / 'index.html').write_text('<html>Bhidne Ho frontend</html>')
    (tmp_path / 'asset.js').write_text('/* bundled frontend */')
    monkeypatch.setenv('BHIDNE_WEB_DIR', str(tmp_path))
    with TestClient(create_app()) as client:
        assert 'Bhidne Ho frontend' in client.get('/').text
        assert client.get('/asset.js').status_code == 200
        assert client.get('/health').json() == {'status': 'ok'}
        guest = client.post('/auth/guest')
        assert guest.status_code == 201
        token = guest.json()['token']
        assert client.get('/rooms', headers={'Authorization': f'Bearer {token}'}).status_code == 200
        assert client.get('/missing.js').status_code == 404


def test_missing_web_build_fails_early(tmp_path, monkeypatch):
    monkeypatch.setenv('BHIDNE_WEB_DIR', str(tmp_path))
    with pytest.raises(RuntimeError, match='index.html'):
        create_app()


def test_hosted_cors_allows_only_configured_frontend(monkeypatch):
    monkeypatch.setenv('BHIDNE_CORS_ORIGINS', ' https://bhidne-ho.lfactorial.com/ ')
    with TestClient(create_app()) as client:
        headers = {
            'Origin': 'https://bhidne-ho.lfactorial.com',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization,content-type',
        }
        response = client.options('/rooms', headers=headers)
        assert response.status_code == 200
        assert response.headers['access-control-allow-origin'] == headers['Origin']
        headers['Origin'] = 'https://unrelated.example'
        response = client.options('/rooms', headers=headers)
        assert response.status_code == 400
        assert 'access-control-allow-origin' not in response.headers

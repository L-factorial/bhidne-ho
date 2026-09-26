import pytest
from app.database import MIGRATIONS
from app.durable_games.bootstrap import Settings, verify_dataset, MARKER
from test_checkpoint_store import database


def settings(**changes):
    values=dict(database='postgresql://localhost/bhidne_distributed_test',redis='redis://localhost:6379',
                secret=b'x'*32,address='gateway-one',origins=('https://game.test',))
    return Settings(**(values|changes))


@pytest.mark.parametrize('change', [dict(database='postgresql://localhost/production'),
    dict(secret=b'short'),dict(address=''),dict(origins=()),dict(origins=('*',)),
    dict(origins=('https://user:password@game.test',)),dict(origins=('https://game.test/path',))])
def test_isolation_configuration_rejects_ambiguous_or_unsafe_bootstrap(change):
    with pytest.raises(ValueError): settings(**change)


def test_environment_requires_explicit_isolation(monkeypatch):
    monkeypatch.delenv('BHIDNE_DISTRIBUTED_ISOLATED',raising=False)
    with pytest.raises(ValueError,match='ISOLATED'): Settings.environment()
    assert settings().namespace=='bhidne-ho:integration:v1'


async def test_schema_and_mode_must_both_match(database):
    pool=database[0]
    with pytest.raises(ValueError,match='Initialize'): await verify_dataset(pool)
    await pool.execute('CREATE TABLE runtime_dataset(singleton boolean PRIMARY KEY, mode text NOT NULL)')
    await pool.execute('INSERT INTO runtime_dataset VALUES(true,%s)',(MARKER,))
    await pool.execute('CREATE TABLE schema_migrations(version integer PRIMARY KEY)')
    for version,_ in MIGRATIONS: await pool.execute('INSERT INTO schema_migrations VALUES(%s)',(version,))
    await verify_dataset(pool)
    await pool.execute('UPDATE runtime_dataset SET mode=%s',('legacy',))
    with pytest.raises(ValueError,match='mode or schema'): await verify_dataset(pool)
    await pool.execute('UPDATE runtime_dataset SET mode=%s',(MARKER,))
    await pool.execute('INSERT INTO schema_migrations VALUES(9999)')
    with pytest.raises(ValueError,match='mode or schema'): await verify_dataset(pool)

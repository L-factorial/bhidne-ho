import pytest
from pydantic import ValidationError

from app.auth.models import SignInInput, SignUpInput
from app.auth.recovery_http import ResetComplete
from app.auth.recovery import PostgresRecoveryService
from app.moderation.policy import RULES_VERSION


def signup(password):
    return SignUpInput(username='alice2026', password=password,
                       email='alice@example.test', community_rules_version=RULES_VERSION)


@pytest.mark.parametrize('password', ['a' * 8, 'a' * 128, '🔑' * 8, ' space & symbols! '])
def test_new_passwords_preserve_all_characters(password):
    assert signup(password).password == password
    assert ResetComplete(token='a' * 43, password=password).password == password


@pytest.mark.parametrize('password', ['', 'a' * 7, 'a' * 129, '🔑' * 7])
def test_new_password_length_boundaries(password):
    with pytest.raises(ValidationError):
        signup(password)
    with pytest.raises(ValidationError):
        ResetComplete(token='a' * 43, password=password)


@pytest.mark.parametrize('password', ['legacy12', 'a' * 14, ' spaces '])
def test_existing_passwords_remain_accepted_for_signin(password):
    assert SignInInput(username='alice2026', password=password).password == password


@pytest.mark.asyncio
async def test_reset_rejects_short_password_before_accessing_database():
    service = PostgresRecoveryService(None)
    with pytest.raises(ValueError, match='8 and 128'):
        await service.reset_password('a' * 43, 'a' * 7)

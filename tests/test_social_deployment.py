import json

import pytest

from scripts.write_social_environment import render


def test_social_deployment_is_opt_in_and_does_not_interpolate_secrets():
    assert render('') == ''
    assert render(json.dumps({'BHIDNE_HO_GOOGLE_WEB_CLIENT_SECRET': 'literal$secret'})) == (
        "BHIDNE_HO_GOOGLE_WEB_CLIENT_SECRET='literal$secret'\n")


@pytest.mark.parametrize('value', [
    {'UNRELATED_SETTING': 'value'},
    {'BHIDNE_HO_GOOGLE_WEB_CLIENT_SECRET': "secret'\nINJECTED=value"},
    {'BHIDNE_HO_SOCIAL_ENABLED_PROVIDERS': ['google']},
    ['google'],
])
def test_social_deployment_rejects_unknown_or_multiline_settings_without_echoing_secrets(value):
    with pytest.raises(ValueError) as caught:
        render(json.dumps(value))
    assert 'secret' not in str(caught.value)

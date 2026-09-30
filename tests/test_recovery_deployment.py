import pytest
from scripts.write_recovery_environment import render

def test_optional_private_recovery_environment():
    assert render('') == ''
    assert render('{"BHIDNE_HO_RECOVERY_SMTP_PASSWORD":"a$b"}') == "BHIDNE_HO_RECOVERY_SMTP_PASSWORD='a$b'\n"
    for raw in ['[]','{"UNSAFE":"x"}','{"BHIDNE_HO_RECOVERY_KEYS":"a\\nb"}','{"BHIDNE_HO_RECOVERY_KEYS":123}']:
        with pytest.raises(ValueError): render(raw)

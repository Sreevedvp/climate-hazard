import logging
import pytest
from pymongo.errors import ConfigurationError, OperationFailure, ServerSelectionTimeoutError
from app.database_diagnostics import database_failure_reason, log_database_failure


@pytest.mark.parametrize('error,reason', [
    (OperationFailure('bad auth', code=18), 'authentication_failed'),
    (OperationFailure('not authorized', code=13), 'permission_denied'),
    (ServerSelectionTimeoutError('SSL handshake failed: TLSV1_ALERT_INTERNAL_ERROR'), 'tls_handshake'),
    (ServerSelectionTimeoutError('SSL handshake failed: CERTIFICATE_VERIFY_FAILED'), 'tls_certificate'),
    (ConfigurationError('All nameservers failed'), 'dns_resolution'),
    (ConfigurationError('invalid option'), 'configuration'),
    (ServerSelectionTimeoutError('connection refused'), 'connection_unavailable'),
])
def test_classification(error, reason):
    assert database_failure_reason(error)[0] == reason


def test_log_never_contains_credentials(monkeypatch, caplog):
    secret = 'private-password'
    uri = 'mongodb+srv://private-user:' + secret + '@example.invalid/'
    monkeypatch.setenv('MONGO_URL', uri)
    with caplog.at_level(logging.ERROR):
        log_database_failure('startup', OperationFailure(uri + ' authentication failed', code=18))
    assert 'reason=authentication_failed' in caplog.text
    assert 'mongo_url_configured=True' in caplog.text
    assert secret not in caplog.text
    assert 'private-user' not in caplog.text
    assert uri not in caplog.text


def test_missing_environment_is_visible(monkeypatch, caplog):
    monkeypatch.delenv('MONGO_URL', raising=False)
    with caplog.at_level(logging.ERROR):
        log_database_failure('request', ServerSelectionTimeoutError('connection refused'))
    assert 'mongo_url_configured=False' in caplog.text

"""Classify database failures without logging exception text or credentials."""
import logging
import os

logger = logging.getLogger(__name__)


def database_failure_reason(exc):
    text = str(exc).lower()
    code = getattr(exc, 'code', None)
    if code == 18 or 'authentication failed' in text or 'bad auth' in text:
        return 'authentication_failed', 'Check Atlas database user and URL-encoded password in Production MONGO_URL.'
    if code == 13 or 'not authorized' in text:
        return 'permission_denied', 'Check database-user permissions for MONGO_DB and index creation.'
    if 'certificate_verify_failed' in text or 'certificate verify failed' in text:
        return 'tls_certificate', 'Check the runtime certificate trust store and any TLS interception.'
    if 'ssl handshake' in text or 'tlsv1_alert' in text:
        return 'tls_handshake', 'Check Atlas network access for backend egress IPs, cluster state, and TLS/network configuration.'
    if any(term in text for term in ('nameserver', 'dns', 'nxdomain', 'query name does not exist', 'getaddrinfo')):
        return 'dns_resolution', 'Check the Atlas hostname, cluster state, and runtime DNS access.'
    if type(exc).__name__ in ('InvalidURI', 'ConfigurationError'):
        return 'configuration', 'Check MONGO_URL syntax, URL-encoded credentials, and driver options.'
    if type(exc).__name__ in ('ServerSelectionTimeoutError', 'NetworkTimeout', 'ConnectionFailure', 'AutoReconnect'):
        return 'connection_unavailable', 'Check Atlas access list, cluster availability, firewall, and connection timeouts.'
    return 'database_operation', 'Inspect MongoDB configuration and server availability; raw error intentionally omitted.'


def log_database_failure(stage, exc):
    reason, hint = database_failure_reason(exc)
    # Never log str(exc), repr(exc), the URI, or a traceback: driver errors
    # can embed credentials or documents. All rendered details are allowlisted.
    logger.error(
        'MongoDB failure stage=%s reason=%s mongo_url_configured=%s. %s',
        stage, reason, bool(os.getenv('MONGO_URL')), hint,
    )

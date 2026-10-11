from starlette.responses import JSONResponse

class BodyLimitMiddleware:
    """Enforce a small JSON request body even without a reverse proxy."""
    def __init__(self, app, limit=16384):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] not in ('POST', 'PUT', 'PATCH'):
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            body.extend(message.get('body', b''))
            if len(body) > self.limit:
                return await JSONResponse({'detail': 'Request body too large'}, status_code=413)(scope, receive, send)
            if not message.get('more_body', False):
                break
        first = True
        async def replay():
            nonlocal first
            if first:
                first = False
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()
        await self.app(scope, replay, send)

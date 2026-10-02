export function ok(data, status = 200, headers) {
  return Response.json({ success: true, data }, { status, headers });
}

export function fail(code, message, status = 400) {
  return Response.json({ success: false, error: { code, message } }, { status });
}

export async function readJson(req) {
  const type = req.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    const error = new Error('content type');
    error.status = 415;
    error.code = 'TYPE';
    throw error;
  }
  return req.json();
}

export function route(fn) {
  return async (req, ctx) => {
    const id = req.headers.get('x-request-id') || '';
    try {
      return await fn(req, ctx);
    } catch (error) {
      console.error(JSON.stringify({ requestId: id, message: error instanceof Error ? error.message : 'error' }));
      if (error?.code === 'DB_DOWN') {
        return fail('DATABASE_UNAVAILABLE', 'Համակարգը ժամանակավորապես հասանելի չէ։', 503);
      }
      return fail('INTERNAL', 'Սխալ տեղի ունեցավ։', 500);
    }
  };
}

// CloudFront Function, viewer-request, S3 DEFAULT behavior only.
// Never associate this function with /backend/* or static /assets/* behavior.
function handler(event) {
    var request = event.request;
    if (request.uri === '/backend' || request.uri.indexOf('/backend/') === 0 || request.uri.indexOf('/api/') === 0 || request.uri.indexOf('/socket.io') === 0) return request;
    if (request.method !== 'GET' && request.method !== 'HEAD') return request;
    var last = request.uri.substring(request.uri.lastIndexOf('/') + 1);
    if (!last || last.indexOf('.') === -1) request.uri = '/index.html';
    return request;
}

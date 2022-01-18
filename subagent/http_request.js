const http = require('http');
const https = require('https');

const http_request = (url, body, options) => {
  body = body || "";
  url = new URL(url);
  const secure = (url.protocol != null && url.protocol.includes('https')) || url.port == 443;
  options = options || {};
  options = {
    hostname: url.hostname,
    port: url.port || (secure? 443 : 80),
    path: url.pathname,
    method: options.method || 'GET',
    headers: {
      'Content-Length': Buffer.byteLength(body),
      ...(options.headers || {})
    }
  };

  const module = secure? https : http;
  
  return new Promise((resolve, reject) => {
    const req = module.request(options, (res) => {
      let response = {}
      let body = []
      if((res.headers['content-type'] || '').startsWith('application')){
        res.setEncoding('binary')
      } else {
        res.setEncoding('utf8');
      }
      res.on('data', (chunk) => {
        body.push(chunk);
      });
      res.on('end', () => {
        response.body = body.join('');
        response.statusCode = res.statusCode;
        response.headers = res.headers;
        if(300 <= res.statusCode && res.statusCode < 400){
            http_request(response.headers.location)
                .then(r => resolve(r))
                .catch(reject)
        } else {
            resolve(response)
        }
      });
    });
    
    req.on('error', (e) => {
      reject(`problem with request: ${e.message}`);
    });
    
    req.write(body);
    req.end();
  })
}

module.exports = http_request;